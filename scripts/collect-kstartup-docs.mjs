#!/usr/bin/env node
// K-Startup 상세페이지에서 공고문 첨부를 받아 본문을 채운다.
//
//   K-Startup 오픈API 는 첨부파일 경로를 안 준다(lib/sources.mjs 케이스타트업행() 주석
//   참조) — 그래서 500건 전부 본문이 없었다(실측 2026-09-04). 그런데 API 가 주는
//   공고url(detl_pg_url) 은 상세페이지고, 그 페이지에 첨부 다운로드 링크가 있다.
//   CLAUDE.md §5 "공고문 스크래핑은 허용" — 대상은 상세페이지·첨부파일뿐이고
//   그 밖으로 나가지 않는다. 이 스크립트가 정확히 그 범위다.
//
//   실측(id 333): 상세페이지 HTML 안에 `<a href="/afile/fileDownload/TOKEN">`,
//   같은 <li> 안에 `title="[첨부파일] [공고문] …4차 모집.pdf"`. 다운로드 URL 자체엔
//   확장자가 없어 title 의 파일명에서 확장자를 얻는다 — extract.mjs 의 extractText() 가
//   확장자로 파서를 고르기 때문이다.
//
//   여러 첨부가 있으면 "[공고문]" 표시가 붙은 것을 우선한다 — 신청서 서식·붙임양식은
//   자격요건이 없다. 없으면 pdf/hwp/hwpx 중 첫 번째를 쓴다.
//
// 사용: node scripts/collect-kstartup-docs.mjs [최대건수, 기본 30] [--force]
import { pgSelect, pgPatch } from "./lib/pgrest.mjs"
import { extractText } from "./lib/extract.mjs"
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
const MIN_TEXT = 200 // 이보다 짧으면 판독 실패로 본다(빈 PDF·스캔본 등)

/**
 * title="[첨부파일] … 이름.ext" 와 href="/afile/fileDownload/TOKEN" 을 짝짓는다.
 *
 * ⚠ 처음엔 `<li class="clear">…</li>` 블록으로 잘라 그 안에서 title·token 을 같이
 *   찾으려 했는데 **실측(id 333)에서 0건이 나왔다.** 바깥 <li class="clear"> 안에
 *   "바로보기"·"다운로드" 두 링크가 각자 또 <li> 로 감싸여 있어(중첩), 비탐욕 정규식
 *   `[\s\S]*?` 이 첫 번째 안쪽 </li>(바로보기 쪽)에서 멈춰버려 다운로드 링크가 그
 *   블록 밖으로 밀려났다. HTML 중첩 구조를 정규식으로 안전하게 못 자른다.
 *   → title 위치와 token 위치를 각각 전체에서 찾고, 문서 순서상 "이 title 다음,
 *   다음 title 이전"에 오는 첫 token 을 그 title 의 첨부로 짝짓는다. 같은 첨부
 *   블록 안에서 title 이 token 보다 항상 먼저 나온다(실측 확인).
 */
function findAttachments(html) {
  const titleRe = /title="\[첨부파일\]\s*([^"]+)"/g
  const titles = []
  let m
  while ((m = titleRe.exec(html))) titles.push({ pos: m.index, 파일명: m[1].trim() })

  const tokenRe = /\/afile\/fileDownload\/([A-Za-z0-9]+)/g
  const tokens = []
  while ((m = tokenRe.exec(html))) tokens.push({ pos: m.index, token: m[1] })

  const out = []
  for (let i = 0; i < titles.length; i++) {
    const start = titles[i].pos
    const end = i + 1 < titles.length ? titles[i + 1].pos : Infinity
    const tok = tokens.find((t) => t.pos > start && t.pos < end)
    if (!tok) continue
    const 파일명 = titles[i].파일명
    const ext = (파일명.split(".").pop() || "").toLowerCase()
    if (!["pdf", "hwp", "hwpx"].includes(ext)) continue
    out.push({ 파일명, ext, token: tok.token, 공고문표시: 파일명.includes("[공고문]") })
  }
  // 공고문 표시가 붙은 것 우선, 없으면 처음 것
  out.sort((a, b) => Number(b.공고문표시) - Number(a.공고문표시))
  return out
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function downloadFile(token, ext, dir) {
  const url = `https://www.k-startup.go.kr/afile/fileDownload/${token}`
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const path = join(dir, `${token}.${ext}`)
  writeFileSync(path, buf)
  return path
}

async function main() {
  const maxCount = Number.isFinite(Number(process.argv[2])) ? Number(process.argv[2]) : 30
  const force = process.argv.includes("--force")

  const filter = force
    ? "출처=eq.K-Startup&공고url=not.is.null"
    : "출처=eq.K-Startup&공고url=not.is.null&본문=is.null"
  const rows = await pgSelect(
    "announcements",
    `select=id,사업명,공고url&${filter}&order=id&limit=${maxCount}`,
  )
  console.log(`대상 ${rows.length}건 (K-Startup, 본문 없음${force ? " — force" : ""})`)

  const dir = mkdtempSync(join(tmpdir(), "kstartup-"))
  let 성공 = 0, 첨부없음 = 0, 실패 = 0

  for (const [i, r] of rows.entries()) {
    process.stdout.write(`[${i + 1}/${rows.length}] [${r.id}] ${String(r.사업명).slice(0, 36)} … `)
    try {
      const html = await fetchText(r.공고url)
      const atts = findAttachments(html)
      if (atts.length === 0) {
        console.log("첨부 없음")
        첨부없음++
        await pgPatch("announcements", `id=eq.${r.id}`, { 파싱상태: "첨부없음" })
        continue
      }
      const a = atts[0]
      const path = await downloadFile(a.token, a.ext, dir)
      const { text, error } = await extractText(path)
      unlinkSync(path)

      if (error || !text || text.trim().length < MIN_TEXT) {
        console.log(`판독실패(${a.ext}, ${text?.length ?? 0}자)${error ? " " + error : ""}`)
        실패++
        await pgPatch("announcements", `id=eq.${r.id}`, { 파싱상태: "판독실패" })
        continue
      }

      await pgPatch("announcements", `id=eq.${r.id}`, {
        본문: text,
        공고문_파일명: a.파일명,
        파싱상태: "파싱완료",
      })
      console.log(`완료 (${a.ext}, ${text.length}자)`)
      성공++
    } catch (e) {
      console.log(`실패: ${e.message}`)
      실패++
    }
  }

  console.log(`\n완료 ${성공} · 첨부없음 ${첨부없음} · 실패 ${실패} / 전체 ${rows.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
