// 확정판정동기화()가 붙기 전(2026-09-04 03:1x)에 남긴 사람 판정은 judgment_semantic 에만
// 있고 eligibility_decisions 에 반영이 안 됐다 — 화면은 AI 제안(확인필요)을 계속 보여준다
// (사용자 지적: 공고 452 "왜 불가이력이 있는데 확인필요임?").
//
// 그 어긋난 건만 골라, app/actions/judgment.ts 의 확정판정동기화() 와 **정확히 같은 삽입**을
// 한 번씩 수행한다. 새 판정을 지어내지 않는다 — 이미 사람이 남긴 판정을 반영만 한다.
//
// 안전장치 둘:
//   · 사람 판정이 최신 확정보다 **뒤**일 때만 반영한다. 더 오래된 판정으로 최신 결정을
//     덮으면 시간을 거꾸로 돌리는 셈이다.
//   · 이미 같은 값이면 건너뛴다(중복 행을 쌓지 않는다).
import { pgSelect, pgInsert } from "../scripts/lib/pgrest.mjs"

const 판정 = await pgSelect("judgment_semantic", "order=created_at.asc&limit=500")
let 반영 = 0, 건너뜀 = 0

for (const j of 판정) {
  if (!j.announcement_id) continue
  const [최신] = await pgSelect(
    "eligibility_decisions",
    `announcement_id=eq.${j.announcement_id}&order=created_at.desc&limit=1`,
  )
  if (최신 && 최신.확정_판정 === j.판정) { 건너뜀++; continue }
  if (최신 && 최신.created_at > j.created_at) {
    console.log(`  건너뜀 #${j.id} 공고${j.announcement_id}: 확정(${최신.확정_판정}, ${최신.created_at})이 사람 판정보다 나중이다`)
    건너뜀++
    continue
  }

  const [행] = await pgInsert("eligibility_decisions", [{
    announcement_id: j.announcement_id,
    ai_제안: 최신?.ai_제안 ?? {},
    ai_확신도: 최신?.ai_확신도 ?? null,
    확정_판정: j.판정,
    정정여부: true,
    정정사유_유형: "직접확인",
    정정사유: j.사유 || j.텍스트,
    확정자: j.답변자,
  }])
  console.log(`  반영 #${j.id} 공고${j.announcement_id}: ${최신?.확정_판정 ?? "(결정없음)"} → ${j.판정} (${j.답변자}) · decisions id=${행.id}`)
  반영++
}

console.log(`\n반영 ${반영}건 · 건너뜀 ${건너뜀}건`)
