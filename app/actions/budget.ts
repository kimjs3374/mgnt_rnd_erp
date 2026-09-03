"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
// 계상이 확정된 과제는 고칠 수 없다. 화면에서도 막지만 **최종 판정은 서버**다(`db/100` 참조).
import { 계상잠김 } from "@/app/actions/budget-confirm"

/**
 * 연구비 계상 — 배정액 저장.
 *
 * 집행(expenses)과 달리 여기엔 AI 가 없다. 계상은 **사람이 협약서를 보고 넣는 숫자**고,
 * 우리가 하는 일은 넣은 뒤에 한도를 검산해 보여주는 것이다(lib/verify.ts).
 * 그래서 확신도도 정정 사유도 받지 않는다 — 없는 판단을 있는 척하지 않는다.
 *
 * ⚠ 저장은 막지 않는다. 한도를 넘겨도 넣을 수 있어야 한다 —
 *   협약 변경 전 시나리오를 화면에서 만들어 보는 것이 이 탭의 용도고,
 *   막아 버리면 「초과했다」는 경고 자체를 볼 수 없게 된다.
 *   대신 저장한 뒤 검증이 즉시 다시 돈다.
 */

export type ActionResult = { ok: boolean; error?: string }

const 재원구분_목록 = ["출연금", "현금", "현물"] as const

/** budgets 의 UNIQUE(과제_id, 비목_대분류, 재원구분) 를 그대로 쓴다. 있으면 갱신, 없으면 삽입. */
export async function saveBudgetLines(
  과제_id: number,
  lines: { 비목_대분류: string; 재원구분: string; 배정액: number; 한도비율: number | null }[],
): Promise<ActionResult> {
  try {
    if (!Number.isInteger(과제_id) || 과제_id <= 0) {
      return { ok: false, error: "과제를 찾을 수 없다." }
    }
    const 잠김 = await 계상잠김(과제_id)
    if (잠김) return { ok: false, error: 잠김 }

    const rows = []
    for (const l of lines) {
      // 화면에서 막고 여기서 또 막는다. DB 의 CHECK 제약이 마지막으로 막는다. 세 겹이다.
      if (!재원구분_목록.includes(l.재원구분 as (typeof 재원구분_목록)[number])) {
        return { ok: false, error: `재원구분이 이상하다: ${l.재원구분}` }
      }
      const 액 = Number(l.배정액)
      if (!Number.isFinite(액) || 액 < 0) {
        return { ok: false, error: "배정액은 0 이상의 숫자여야 한다." }
      }
      // 원 단위 정수만 넣는다. bigint 컬럼이라 소수가 들어가면 DB 에서 터진다.
      rows.push({
        과제_id,
        비목_대분류: l.비목_대분류,
        재원구분: l.재원구분,
        배정액: Math.round(액),
        한도비율: l.한도비율,
      })
    }
    if (!rows.length) return { ok: false, error: "저장할 줄이 없다." }

    const { error } = await db
      .from("budgets")
      .upsert(rows, { onConflict: "과제_id,비목_대분류,재원구분" })
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath("/budget")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 배정액 0 짜리 줄을 지운다. 「0 으로 두기」와 「그 재원을 안 쓴다」는 다르다. */
export async function deleteBudgetLine(
  과제_id: number,
  비목_대분류: string,
  재원구분: string,
): Promise<ActionResult> {
  try {
    const 잠김 = await 계상잠김(과제_id)
    if (잠김) return { ok: false, error: 잠김 }

    const { error } = await db
      .from("budgets")
      .delete()
      .eq("과제_id", 과제_id)
      .eq("비목_대분류", 비목_대분류)
      .eq("재원구분", 재원구분)
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath("/budget")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
