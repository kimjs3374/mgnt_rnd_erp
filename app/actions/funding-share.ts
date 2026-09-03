"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
// 계상이 확정된 과제는 재원 구성도 못 고친다 — 계상 합계가 재원과 맞춰져 있기 때문이다.
import { 계상잠김 } from "@/app/actions/budget-confirm"

/**
 * 협약 재원 구성 저장 — 정부출연금 · 민간부담 현금 · 민간부담 현물.
 *
 * 이 세 숫자는 `lib/verify.ts` ②번 검증의 **기준**이다(계상액을 이 금액과 대조한다).
 * 그래서 여기엔 AI 가 없다 — 값은 `lib/funding-share.ts` 가 공고·규정 규칙으로 계산하고,
 * 사람이 확인해서 저장한다. 계산 근거는 화면에 원문으로 띄운다.
 *
 * ⚠ **합계가 총사업비와 다르면 저장을 막는다.** 계상(budgets)은 한도를 넘겨도 넣을 수 있게
 *   열어 뒀지만(협약 변경 전 시나리오를 만들어 보는 용도), 협약서의 세 금액은 합이 총사업비인
 *   것이 산수다. 여기서 어긋난 값을 넣으면 verify 의 ①②가 영구히 빨간불이 되고,
 *   화면이 「무엇이 잘못됐는지」를 가리키지 못한다.
 */

export type ActionResult = { ok: boolean; error?: string }

const 원 = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원"

export async function saveContractShare(
  과제_id: number,
  값: { 정부지원금: number; 기관부담_현금: number; 기관부담_현물: number },
): Promise<ActionResult> {
  try {
    if (!Number.isInteger(과제_id) || 과제_id <= 0) {
      return { ok: false, error: "과제를 찾을 수 없다." }
    }
    const 잠김 = await 계상잠김(과제_id)
    if (잠김) return { ok: false, error: 잠김 }

    const 항목 = [
      ["정부지원금", 값.정부지원금],
      ["기관부담_현금", 값.기관부담_현금],
      ["기관부담_현물", 값.기관부담_현물],
    ] as const
    for (const [이름, v] of 항목) {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${이름} 은 0 이상의 숫자여야 한다.` }
      }
    }
    const 정부지원금 = Math.round(Number(값.정부지원금))
    const 기관부담_현금 = Math.round(Number(값.기관부담_현금))
    const 기관부담_현물 = Math.round(Number(값.기관부담_현물))
    const 합계 = 정부지원금 + 기관부담_현금 + 기관부담_현물

    // 총사업비를 다시 읽는다. 화면이 들고 있던 값을 믿지 않는다 — 그 사이 바뀌었을 수 있다.
    const { data, error: readErr } = await db
      .from("projects")
      .select("*")
      .eq("id", 과제_id)
      .limit(1)
    if (readErr) return { ok: false, error: readErr.message }
    const p = (data ?? [])[0] as { 총사업비?: number | null } | undefined
    if (!p) return { ok: false, error: "과제를 찾을 수 없다." }

    const 총사업비 = p.총사업비 == null ? null : Number(p.총사업비)
    if (총사업비 != null && 총사업비 > 0 && 합계 !== 총사업비) {
      const 차 = 합계 - 총사업비
      return {
        ok: false,
        error:
          `재원 합계 ${원(합계)} 가 총사업비 ${원(총사업비)} 와 ${원(Math.abs(차))} ` +
          `${차 > 0 ? "많습니다" : "적습니다"}. 협약서의 세 금액은 합이 총사업비여야 합니다.`,
      }
    }

    const { error } = await db
      .from("projects")
      .update({ 정부지원금, 기관부담_현금, 기관부담_현물 })
      .eq("id", 과제_id)
    if (error) return { ok: false, error: error.message }

    // 계상 탭의 한도 검증 기준이 바뀌었으므로 과제 상세 전체를 다시 그린다.
    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath(`/projects/${과제_id}/settlement`)
    revalidatePath("/projects")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
