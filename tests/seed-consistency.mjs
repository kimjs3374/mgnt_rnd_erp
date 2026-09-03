// 시연 전 시드 점검 — **화면이 아니라 데이터가 대본과 어긋나지 않았는지** 본다.
//
// 왜 필요한가: 시드는 DB 에 직접 넣기 때문에 **서버 액션의 게이트를 지나치지 않는다.**
// 실제로 `expenses` id=5 가 「확신도 58% · 확정 · 정정 아님」이었다 — 화면으로는 만들 수 없는
// 조합이고, 심사장에서 「58%인데 왜 확정됐죠?」 한 마디에 답이 없다(`db/99_seed_confidence_fix.sql`).
// 그런 게 하나 생기면 확신도 게이트라는 핵심 주장이 표 위에서 반증된다.
//
// 네 명이 각자 DB 를 직접 만지므로(CLAUDE.md §3.5) **리허설 전에 한 번 돌린다.**
//   cd /web/rnd && node tests/seed-consistency.mjs          점검만
//   cd /web/rnd && node tests/seed-consistency.mjs --fix     5:00 장면만 되돌린다
//
// ⚠⚠ **`tests/e2e-expense-modal.mjs` 를 돌리면 5:00 장면이 깨진다.** 그 테스트는 검토대기 노트북을
//    실제로 정정하고 **되돌리지 않는다**(2026-09-04 실측). 돌린 뒤 반드시 `--fix` 를 붙여 이 스크립트를
//    한 번 더 돌린다. 그 파일은 김정수 담당이라 여기서 고치지 않았다(CLAUDE.md §1) — 말은 해 뒀다.
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const 고치기 = process.argv.includes("--fix")

/**
 * 5:00 장면의 정답 상태. **이것만** 되돌린다 — 아무 어긋남이나 자동으로 고치면
 * 남이 일부러 바꾼 것까지 되돌려 놓는다.
 */
const 노트북정답 = { id: 6, 비목_대분류: "FACILITY", 비목_세부항목: "EQUIP_PURCHASE", 상태: "검토대기" }

function 헤더() {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Accept-Profile": "app",
    "Content-Profile": "app",
    "Content-Type": "application/json",
  }
}

async function 되돌리기() {
  const { id, ...값 } = 노트북정답
  const d = await fetch(`${env.SUPABASE_URL}/rest/v1/decisions?expense_id=eq.${id}`, {
    method: "DELETE",
    headers: 헤더(),
  })
  const e = await fetch(`${env.SUPABASE_URL}/rest/v1/expenses?id=eq.${id}`, {
    method: "PATCH",
    headers: 헤더(),
    body: JSON.stringify(값),
  })
  console.log(`  ↩ 노트북 ${id} 되돌림 — decisions ${d.status} · expenses ${e.status}`)
}

if (고치기) await 되돌리기()

/** `app/actions/expenses.ts` 의 CONFIDENCE_THRESHOLD 와 같은 값이어야 한다. */
const 게이트 = 0.7

let 실패 = 0
const 확인 = (ok, 말, 곁들임 = "") => {
  if (!ok) 실패++
  console.log(`  ${ok ? "✓" : "✗"} ${말}${곁들임 ? ` — ${곁들임}` : ""}`)
}

const [집행, 판단, 과제, 예산] = await Promise.all([
  pgSelect("expenses", "select=*"),
  pgSelect("decisions", "select=*"),
  pgSelect("projects", "select=*"),
  pgSelect("budgets", "select=*"),
])

const 정정된집행 = new Set(판단.filter((d) => d.정정여부).map((d) => d.expense_id))
const 품목글자 = (e) => JSON.stringify(e.품목 ?? "")

// ① 확신도 게이트 — 화면으로 만들 수 없는 상태가 데이터에 있으면 안 된다
const 모순 = 집행.filter(
  (e) =>
    e.상태 === "확정" &&
    e.ai_확신도 != null &&
    Number(e.ai_확신도) < 게이트 &&
    !정정된집행.has(e.id),
)
확인(
  모순.length === 0,
  `확신도 ${게이트 * 100}% 미만인데 정정 없이 확정된 건 ${모순.length}건`,
  모순.map((e) => `id=${e.id} ${e.거래처} ${Math.round(Number(e.ai_확신도) * 100)}%`).join(" / "),
)

// ② 스냅샷이 본표와 같은가 — decisions.ai_제안 은 「그때 AI 가 뭐라 했는지」의 박제다
const 어긋난스냅샷 = 판단.filter((d) => {
  const e = 집행.find((x) => x.id === d.expense_id)
  const s = d.ai_제안?.확신도
  return e && s != null && e.ai_확신도 != null && Number(s) !== Number(e.ai_확신도)
})
확인(
  어긋난스냅샷.length === 0,
  `ai_제안 스냅샷이 본표와 다른 건 ${어긋난스냅샷.length}건`,
  어긋난스냅샷.map((d) => `expense=${d.expense_id}`).join(" / "),
)

// ③ CLAUDE.md §9 절대 규칙 — 노트북 정정 이력은 **0건**이어야 한다.
//    미리 심으면 5:00 재투입 때 확신도가 이미 올라가 있어 발표 논지가 성립하지 않는다.
const 노트북정정 = 판단.filter((d) => {
  const e = 집행.find((x) => x.id === d.expense_id)
  return d.정정여부 && e && 품목글자(e).includes("노트북")
})
확인(노트북정정.length === 0, `노트북 정정 이력 ${노트북정정.length}건 (0이어야 한다)`)

// ④ 5:00 장면이 성립하려면 — 분류 안 된 노트북 1건 + 과거에 확정된 노트북 1건
const 노트북 = 집행.filter((e) => 품목글자(e).includes("노트북"))
const 대기노트북 = 노트북.filter((e) => e.상태 === "검토대기")
const 과거노트북 = 노트북.filter((e) => e.상태 === "확정")
확인(대기노트북.length === 1, `검토대기 노트북 ${대기노트북.length}건 (현장에서 분류할 건)`)
확인(
  과거노트북.length >= 1,
  `과거 확정된 노트북 ${과거노트북.length}건 (판단 우선순위 2층)`,
  과거노트북.map((e) => `${e.거래처}→${e.비목_대분류}`).join(" / "),
)

// ⑤ 대본 숫자 — 여기가 바뀌면 대시보드와 발표가 어긋난다
const 검토대기 = 집행.filter((e) => e.상태 === "검토대기")
확인(검토대기.length === 1, `검토대기 ${검토대기.length}건`)
확인(과제.length === 12, `과제 ${과제.length}건`)

const P01 = 예산.filter((b) => b.과제_id === 2).reduce((s, b) => s + Number(b.배정액 ?? 0), 0)
확인(P01 === 137000000, `P01 예산 합계 ${P01.toLocaleString("ko-KR")}원`)

// ⑥ 한도 위반은 P01 연구수당 1건만이 정상이다(시연용). 늘면 화면에 경고가 여러 개 떠 대본이 흐려진다.
console.log(`  · decisions ${판단.length}건 (정정 ${판단.filter((d) => d.정정여부).length}건)`)

if (실패 && !고치기) {
  console.log("\n  5:00 장면(노트북)만 어긋난 것이면 `node tests/seed-consistency.mjs --fix` 로 되돌린다.")
}
console.log(실패 ? `\n✗ ${실패}건 어긋남 — 리허설 전에 고칠 것` : "\n✓ 시드가 대본과 맞는다")
process.exit(실패 ? 1 : 0)
