#!/usr/bin/env node
// 기업마당 첨부를 받아 본문을 채운다 — LLM 호출 0회.
//
//   scripts/collect-bizinfo.mjs 의 processOne() 은 이미 첨부 다운로드+추출을 하지만,
//   그건 selectRelevant()(LLM 1차 거르기)에 걸린 회사 관련 후보 몇 건(기본 20건)만
//   대상으로 한다 — 그래서 302건 중 39건만 본문이 있다(실측 2026-09-04).
//   이 스크립트는 **거르지 않고** 본문 없는 전부를 대상으로 하되, LLM 을 아예 안 부른다
//   (요구서류 판독 extractDocuments() 도 안 부른다 — 그건 다른 도구가 나중에 한다).
//
//   기업마당 API 는 K-Startup 과 달리 첨부 URL 을 목록 응답에 그대로 준다
//   (printFileNm=파일명, printFlpthNm=다운로드URL) — 상세페이지를 스크래핑할 필요가
//   없다. 그래서 목록을 다시 받아(API 호출 1회) DB 의 미판독 건과 출처_id 로 맞춘다.
//
// 사용: node scripts/collect-bizinfo-docs.mjs [최대건수, 기본 300]
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { pgSelect, pgPatch } from "./lib/pgrest.mjs"
import { extractText } from "./lib/extract.mjs"

function loadEnv(path = "/web/rnd/.env.local") {
  const env = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue
    const i = line.indexOf("=")
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}
const env = loadEnv()
const API = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"
const MIN_TEXT = 200

async function fetchList(cnt = 300) {
  const url = `${API}?crtfcKey=${env.BIZINFO_API_KEY}&dataType=json&searchCnt=${cnt}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  const j = await res.json()
  return j.jsonArray ?? []
}

async function downloadFile(url, name, workdir) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const stem = (name.replace(/\.[^.]+$/, "") || name).replace(/[^\w가-힣-]/g, "_").slice(0, 60)
  const ext = (name.split(".").pop() || "").toLowerCase()
  const dst = join(workdir, ext ? `${stem}.${ext}` : stem)
  writeFileSync(dst, buf)
  return dst
}

async function main() {
  const maxCount = Number.isFinite(Number(process.argv[2])) ? Number(process.argv[2]) : 300

  const [list, 미판독] = await Promise.all([
    fetchList(300),
    pgSelect(
      "announcements",
      "select=id,출처_id,사업명&출처=eq.기업마당&본문=is.null&order=id",
    ),
  ])
  console.log(`기업마당 API ${list.length}건 · DB 미판독 ${미판독.length}건`)

  const byId = new Map(list.map((rec) => [String(rec.pblancId), rec]))
  const targets = 미판독
    .filter((a) => byId.has(a.출처_id))
    .slice(0, maxCount)
  console.log(`대상 ${targets.length}건 (API 목록에 아직 있는 것만 — 마감돼 내려간 공고는 다음 수집이 처리한다)`)

  const workdir = mkdtempSync(join(tmpdir(), "bizinfo-docs-"))
  let 성공 = 0, 첨부없음 = 0, 실패 = 0

  for (const [i, a] of targets.entries()) {
    const rec = byId.get(a.출처_id)
    const name = String(rec.printFileNm || "")
    const url = String(rec.printFlpthNm || "")
    process.stdout.write(`[${i + 1}/${targets.length}] [${a.id}] ${String(a.사업명).slice(0, 36)} … `)

    if (!name || !url) {
      console.log("첨부 없음")
      첨부없음++
      await pgPatch("announcements", `id=eq.${a.id}`, { 파싱상태: "첨부없음" })
      continue
    }

    try {
      const path = await downloadFile(url, name, workdir)
      const { text, error } = await extractText(path)
      if (error || !text || text.trim().length < MIN_TEXT) {
        console.log(`판독실패(${text?.length ?? 0}자)${error ? " " + error : ""}`)
        실패++
        await pgPatch("announcements", `id=eq.${a.id}`, { 파싱상태: "판독실패" })
        continue
      }
      await pgPatch("announcements", `id=eq.${a.id}`, {
        본문: text.slice(0, 100000),
        공고문_파일명: name,
        파싱상태: "파싱완료",
      })
      console.log(`완료 (${text.length}자)`)
      성공++
    } catch (e) {
      console.log(`실패: ${e.message}`)
      실패++
    }
    await new Promise((r) => setTimeout(r, 200)) // 원 서버 예의상 간격
  }

  console.log(`\n완료 ${성공} · 첨부없음 ${첨부없음} · 실패 ${실패} / 전체 ${targets.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
