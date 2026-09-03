#!/usr/bin/env node
// 공고 상세 패널용 요약 캐시 채우기 — 본문 판독이 끝난 공고 중 app.ann_summary 가 아직
// 없는 것만 골라 claude -p 헤드리스로 지원분야·지원대상·지원규모·접수방법·문의처·
// 사업요약을 뽑는다. 이미 뽑힌 공고는 다시 부르지 않는다(호출당 약 4만 토큰 — 재수집
// 때마다 다시 부르면 낭비다. scripts/collect-*.mjs 의 요구서류 판독과 같은 이유).
//
// 사용: node scripts/extract-summaries.mjs [최대건수, 기본 30]
import { pgSelect, pgInsert } from "./lib/pgrest.mjs"
import { extractSummary } from "./lib/llm.mjs"

async function main() {
  const maxCount = process.argv[2] ? Number(process.argv[2]) : 30

  const [rows, existing] = await Promise.all([
    pgSelect("announcements", "select=id,사업명,본문&본문=not.is.null&order=id"),
    pgSelect("ann_summary", "select=announcement_id"),
  ])
  const done = new Set(existing.map((s) => s.announcement_id))
  const targets = rows.filter((r) => !done.has(r.id)).slice(0, maxCount)

  console.log(`본문 있는 공고 ${rows.length}건 중 요약 없는 ${targets.length}건 처리(최대 ${maxCount}건)`)

  let ok = 0
  for (const r of targets) {
    process.stdout.write(`[${r.id}] ${String(r.사업명).slice(0, 40)} ... `)
    try {
      const res = await extractSummary(r.본문)
      if (!res.ok || !res.summary) {
        console.log("실패")
        continue
      }
      const s = res.summary
      await pgInsert("ann_summary", [
        {
          announcement_id: r.id,
          지원분야: s.지원분야 ?? null,
          지원대상: s.지원대상 ?? null,
          지원규모: s.지원규모 ?? null,
          접수방법: s.접수방법 ?? null,
          문의처: s.문의처 ?? null,
          사업요약: s.사업요약 ?? null,
          ai_확신도: typeof s.확신도 === "number" ? s.확신도 : null,
        },
      ])
      ok++
      console.log("완료")
    } catch (e) {
      console.log(`실패: ${e.message}`)
    }
  }
  console.log(`완료 ${ok} / ${targets.length}건`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
