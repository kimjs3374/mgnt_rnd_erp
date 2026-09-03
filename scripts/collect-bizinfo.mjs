#!/usr/bin/env node
// 기업마당 공식 오픈API 수집 — 지원사업 > 공고 탐색 전용 (과제사업의 NTIS·IRIS와 출처를 섞지 않는다).
// 로직은 01. 사전준비/프로토타입/gongo.py(2026-08-21, 1,558건 수집·PDF/HWP 판독 검증됨)를 이식.
//
// 사용: node scripts/collect-bizinfo.mjs [최대건수]
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { pgUpsertByFilter, pgSelect, pgInsert } from "./lib/pgrest.mjs"
import { extractText, findSections } from "./lib/extract.mjs"
import { extractDocuments } from "./lib/llm.mjs"

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

async function fetchList(cnt = 300) {
  const url = `${API}?crtfcKey=${env.BIZINFO_API_KEY}&dataType=json&searchCnt=${cnt}`
  const res = await fetch(url)
  const j = await res.json()
  return j.jsonArray ?? []
}

// reqstBeginEndDe 는 절반 넘게 날짜가 아니다. 지어내지 말고 유형으로 나눈다. (gongo.py 그대로)
function parseDeadline(s) {
  s = (s || "").trim()
  const m = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/.exec(s)
  if (m) return { type: "dated", start: m[1], end: m[2] }
  for (const [k, t] of [
    ["상시", "상시"], ["소진", "소진시"], ["선착순", "소진시"],
    ["상이", "상이"], ["완료", "완료시"],
  ]) {
    if (s.includes(k)) return { type: t, start: null, end: null }
  }
  return { type: "미상", start: null, end: null }
}

async function downloadFile(url, name, workdir) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
  const buf = Buffer.from(await res.arrayBuffer())
  const stem = (name.replace(/\.[^.]+$/, "") || name).replace(/[^\w가-힣-]/g, "_").slice(0, 60)
  const ext = (name.split(".").pop() || "").toLowerCase()
  const dst = join(workdir, ext ? `${stem}.${ext}` : stem)
  writeFileSync(dst, buf)
  return dst
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

async function processOne(rec, workdir) {
  const deadline = parseDeadline(rec.reqstBeginEndDe)
  const name = String(rec.printFileNm || "")
  const url = String(rec.printFlpthNm || "")

  const row = {
    출처: "기업마당",
    출처_id: rec.pblancId,
    사업명: rec.pblancNm,
    소관부처: rec.jrsdInsttNm ?? null,
    전문기관: rec.excInsttNm ?? null,
    지역: null, // 기업마당 레코드에 지역 필드가 없다. 지어내지 않는다.
    접수시작: deadline.start,
    접수종료: deadline.end,
    마감유형: deadline.type,
    공고문_파일명: name || null,
    공고문_url: url || null,
    사업유형: null, // 기업마당은 오픈API가 사업유형을 안 준다 — 「미분류」로 정직하게 둔다
    파싱상태: "수집완료",
  }

  let text = ""
  if (name && url) {
    try {
      const path = await downloadFile(url, name, workdir)
      const ext = await extractText(path)
      text = ext.text
      row.파싱상태 = text ? "파싱완료" : "파싱실패"
    } catch (e) {
      row.파싱상태 = "파싱실패"
      console.error(`  [${rec.pblancId}] 첨부 다운로드/추출 실패: ${e.message}`)
    }
  } else {
    row.파싱상태 = "첨부없음"
  }
  if (!text && rec.bsnsSumryCn) text = stripHtml(rec.bsnsSumryCn) // 첨부가 안 열리면 API 요약이라도 남긴다
  if (text) row.본문 = text.slice(0, 100000)

  const filter = `출처=eq.기업마당&출처_id=eq.${encodeURIComponent(rec.pblancId)}`
  const [saved] = await pgUpsertByFilter("announcements", filter, row)

  let docCount = 0
  if (text) {
    const sections = findSections(text)
    if (sections.length > 0 && saved?.id) {
      try {
        const existing = await pgSelect("ann_required_docs", `announcement_id=eq.${saved.id}&select=id&limit=1`)
        if (existing.length === 0) {
          const r = extractDocuments(sections)
          if (r.ok && Array.isArray(r.docs)) {
            const docRows = r.docs.map((d) => ({
              announcement_id: saved.id,
              서류명: d.서류명,
              필수여부: d.구분 === "필수",
              구분: d.구분 ?? "확인필요",
              유효기간_문구: d.비고 ?? null,
              원문: d.근거문장,
              근거문장: d.근거문장,
              확인상태: "미확인",
            }))
            await pgInsert("ann_required_docs", docRows)
            docCount = docRows.length
          }
        }
      } catch (e) {
        console.error(`  [${rec.pblancId}] 요구서류 판독 실패: ${e.message}`)
      }
    }
  }

  return { 파싱상태: row.파싱상태, 문서건수: docCount }
}

async function main() {
  const maxCount = process.argv[2] ? Number(process.argv[2]) : 10
  const workdir = mkdtempSync(join(tmpdir(), "bizinfo-"))
  console.log(`작업 디렉터리: ${workdir}`)

  const list = await fetchList(300)
  console.log(`기업마당 전체 ${list.length}건 중 최신 ${Math.min(maxCount, list.length)}건 처리`)

  for (const rec of list.slice(0, maxCount)) {
    process.stdout.write(`[${rec.pblancId}] ${String(rec.pblancNm).slice(0, 40)} ... `)
    try {
      const r = await processOne(rec, workdir)
      console.log(`${r.파싱상태} · 문서 ${r.문서건수}건`)
    } catch (e) {
      console.log(`실패: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
