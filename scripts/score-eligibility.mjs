#!/usr/bin/env node
// 자격판정 점수 매기기 — 본문이 있는 공고를 회사 정보(company_profile)와 대조해
// LLM(bot/gongo.py score_eligibility, 게이트웨이 /eligibility/score)이 0~100점을 매기고
// app.eligibility_decisions 에 기록한다. 규칙표로 대체하지 않는다 — CLAUDE.md 9/3 결정
// ("판정은 LLM이 한다")을 그대로 따른다.
//
// 확신도 0.70 미만은 여기서 "확인필요"로 강제한다 — 코드가 막는다, 프롬프트를 믿지 않는다
// (§6 설계 원칙 3번). 이미 판정된 공고는 다시 부르지 않는다(재수집마다 부르면 호출당
// 비용이 쌓인다 — scripts/extract-summaries.mjs 와 같은 이유).
//
// 사용: node scripts/score-eligibility.mjs [최대건수, 기본 30]
import { pgSelect, pgInsert } from "./lib/pgrest.mjs"
import { scoreEligibility } from "./lib/llm.mjs"
import { companyProfileText } from "./lib/company.mjs"

async function main() {
  const maxCount = process.argv[2] ? Number(process.argv[2]) : 30

  const company = await companyProfileText()
  if (!company) {
    console.log("company_profile 이 비어 있어 판정할 수 없다.")
    return
  }
  console.log(`회사 정보: ${company}`)

  const [rows, existing] = await Promise.all([
    pgSelect("announcements", "select=id,사업명,본문&본문=not.is.null&order=id"),
    pgSelect("eligibility_decisions", "select=announcement_id"),
  ])
  const done = new Set(existing.map((d) => d.announcement_id))
  const targets = rows.filter((r) => !done.has(r.id)).slice(0, maxCount)
  console.log(`본문 있는 공고 ${rows.length}건 중 판정 없는 ${targets.length}건 처리(최대 ${maxCount}건)`)

  let ok = 0
  for (const r of targets) {
    process.stdout.write(`[${r.id}] ${String(r.사업명).slice(0, 40)} ... `)
    try {
      const result = await scoreEligibility(company, r.본문)
      if (!result) {
        console.log("실패")
        continue
      }

      let 확신도 = typeof result.확신도 === "number" ? result.확신도 : 0
      const 원판정 = result.판정
      let 판정 = 원판정
      // 0.70 미만은 「확인필요」로 강제한다 — 애매한 걸 「가능/불가」로 확정하지 않는다.
      // ⚠ 원판정은 버리지 않고 ai_제안에 같이 남긴다 — 화면에서 "AI는 가능이라 봤지만
      //   확신도가 낮아 확인필요로 내렸다"를 그대로 보여주기 위한 근거다(사용자 요청,
      //   2026-09-03: "왜 그런 판정인지 확실한 근거가 필요").
      if (확신도 < 0.7) 판정 = "확인필요"
      if (!["가능", "불가", "확인필요"].includes(판정)) 판정 = "확인필요"

      await pgInsert("eligibility_decisions", [
        {
          announcement_id: r.id,
          ai_제안: {
            점수: typeof result.점수 === "number" ? result.점수 : null,
            근거: Array.isArray(result.근거) ? result.근거 : [],
            확인필요항목: Array.isArray(result.확인필요항목) ? result.확인필요항목 : [],
            원판정: 원판정 !== 판정 ? 원판정 : null,
          },
          ai_확신도: 확신도,
          확정_판정: 판정,
        },
      ])
      ok++
      console.log(`완료 (${result.점수}점, ${판정}, 확신도 ${확신도})`)
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
