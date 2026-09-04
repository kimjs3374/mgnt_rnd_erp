"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"

export type ActionResult = { ok: boolean; error?: string }

/**
 * 제출 전 점검 — 무시 처리.
 *
 * 「무시함」만 여기서 다룬다. 「수정함」은 담당자가 실제로 원인(예: 중간보고 완료일 입력,
 * 비목 배정을 줄임)을 고친 뒤 `scripts/check-programs.mjs` 를 다시 돌리면 조건이 안 걸려
 * 저절로 안 뜬다 — 사람이 "수정했다"고 따로 누를 필요가 없다. 무시는 다르다.
 * 조건은 그대로인데 사람이 "지금은 괜찮다"고 판단한 것이라 **왜 무시하는지가 반드시 남아야**
 * 한다(decisions·eligibility_decisions 와 같은 원칙 — DB CHECK 제약이 사유 없는 무시를 막는다).
 */
export async function dismissCheck(
  id: number,
  사유: string,
  처리자: string,
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "점검 항목을 찾을 수 없다." }
  if (!사유.trim()) return { ok: false, error: "무시하는 이유를 적어야 한다." }

  try {
    const { error } = await db
      .from("program_checks")
      .update({
        처리: "무시함",
        처리사유: 사유.trim(),
        처리자,
        처리일시: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) return { ok: false, error: error.message }

    revalidatePath("/programs")
    revalidatePath("/projects/all")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
