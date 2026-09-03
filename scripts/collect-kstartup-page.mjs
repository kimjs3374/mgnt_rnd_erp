#!/usr/bin/env node
// K-Startup 상세페이지 "본문" 자체를 본문으로 받는다 — 첨부가 없는 376건 대상.
//
//   collect-kstartup-docs.mjs 는 상세페이지의 "첨부파일"만 받는다. 그런데 첨부가
//   없어도 페이지 자체에 실제 공고 내용이 있다(실측 2026-09-04, id 335 "[창업 교육]
//   투자자가 보는 기업 가치와 IR 전략") — 지원분야·접수기간·신청대상·제출서류·선정절차
//   같은 구조화된 항목과 자유문이 다 있다. 이걸 그냥 버리고 있었다.
//
//   사용자 지적: "이벤트 공지는 별도 필터링으로 제외시켜야함" — 이 본문이 있어야
//   ann_features.py 의 R-EVENT-* 규칙(일시/장소, 무료, 신청대상 제한없음)이 걸려
//   진짜 이벤트를 "해당없음"으로 가려낼 수 있다. 지원분야 태그만으론 못 가른다
//   (실측: 같은 태그 안에 전시회 참가비 지원 같은 진짜 지원사업이 섞여 있었다).
//
//   ⚠ 첨부 문서(파싱완료)와 파싱상태를 다르게 둔다("상세페이지") — 첨부 원문을
//   파싱한 것과 웹페이지 자체 설명을 옮긴 것은 신뢰도가 다르다. 화면·리포트가
//   둘을 섞어 "공고문을 읽었다"고 하지 않게 하려는 것이다(오늘 오전 지적과 같은 이유).
//
// 사용: node scripts/collect-kstartup-page.mjs [최대건수, 기본 400]
import { pgSelect, pgPatch } from "./lib/pgrest.mjs"

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
const MIN_TEXT = 150 // 첨부 원문(200자)보다 낮춘다 — 상세페이지 항목표는 원래 짧다

function extractDetailBody(html) {
  const start = html.indexOf('id="scrTitle"')
  const end = html.indexOf('class="guide_wrap"')
  if (start < 0 || end < 0 || end <= start) return ""
  let seg = html.slice(start, end)
  seg = seg.replace(/<\/(p|li|div|h[1-6]|tr)>/gi, "\n")
  seg = seg.replace(/<br\s*\/?>/gi, "\n")
  seg = seg.replace(/<[^>]+>/g, " ")
  seg = seg.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  seg = seg.replace(/[ \t]+/g, " ")
  seg = seg.replace(/\n[ \t]*\n+/g, "\n")
  return seg.trim()
}

async function main() {
  const maxCount = Number.isFinite(Number(process.argv[2])) ? Number(process.argv[2]) : 400
  const rows = await pgSelect(
    "announcements",
    `select=id,사업명,공고url&출처=eq.K-Startup&파싱상태=eq.첨부없음&order=id&limit=${maxCount}`,
  )
  console.log(`대상 ${rows.length}건 (첨부없음 상태)`)

  let ok = 0, 짧음 = 0, 실패 = 0
  for (const [i, r] of rows.entries()) {
    process.stdout.write(`[${i + 1}/${rows.length}] [${r.id}] ${String(r.사업명).slice(0, 36)} … `)
    try {
      const res = await fetch(r.공고url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      const text = extractDetailBody(html)
      if (text.length < MIN_TEXT) {
        console.log(`짧음(${text.length}자) — 그대로 첨부없음 유지`)
        짧음++
        continue
      }
      await pgPatch("announcements", `id=eq.${r.id}`, { 본문: text, 파싱상태: "상세페이지" })
      console.log(`완료 (${text.length}자)`)
      ok++
    } catch (e) {
      console.log(`실패: ${e.message}`)
      실패++
    }
  }
  console.log(`\n완료 ${ok} · 짧음(그대로둠) ${짧음} · 실패 ${실패} / 전체 ${rows.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
