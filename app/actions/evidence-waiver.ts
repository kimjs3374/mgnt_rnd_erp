"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

/**
 * 증빙 **면제**(강제 정상 처리) · 해제. (2026-09-04 사용자 지시 — db/114)
 *
 * ★ **증빙 파일을 가짜로 만들지 않는다.** 「없는 것을 있다고」 하면 정산 실사에서 파일을 못 내놓는다.
 *   면제는 「이 칸은 이 사유로 비워 둔다」는 **사람의 판단**이고, 그 판단을 그대로 남긴다.
 *
 * ★ **사유는 필수다.** 빈 사유를 받으면 나중에 아무도 왜 그랬는지 모른다 — 화면에서 막고,
 *   여기서 또 막고, DB CHECK 가 마지막으로 막는다. 세 겹이다.
 *
 * 면제·해제를 **행으로 쌓는다**(덮어쓰지 않는다). 「누가 왜 면제했다가 왜 되돌렸는지」가
 * 사라지면 그게 정산에서 설명 못 하는 자리가 된다(`app.budget_confirmations` 와 같은 방식).
 */

export type WaiverResult = { ok: boolean; error?: string }

/** 그 집행 건이 속한 과제 — 화면을 다시 그리려면 어느 경로를 revalidate 할지 알아야 한다. */
async function 과제찾기(집행_id: number): Promise<number | null> {
  const { data } = await db.from("expenses").select("*").eq("id", 집행_id).limit(1)
  const row = (data ?? [])[0] as { 과제_id?: number | null } | undefined
  return row?.과제_id == null ? null : Number(row.과제_id)
}

async function 남기기(
  집행_id: number,
  요건_id: number,
  동작: "면제" | "해제",
  사유: string,
  사유유형: string | null,
): Promise<WaiverResult> {
  const 다듬은 = 사유.trim()
  if (!다듬은) {
    return {
      ok: false,
      error:
        동작 === "면제"
          ? "면제 사유를 적어야 합니다 — 왜 이 서류가 없어도 되는지가 정산에서 그대로 근거가 됩니다."
          : "해제 사유를 적어야 합니다 — 왜 다시 미비로 돌리는지 남겨야 합니다.",
    }
  }
  if (!Number.isInteger(집행_id) || !Number.isInteger(요건_id)) {
    return { ok: false, error: "어느 집행의 어느 서류인지 알 수 없습니다." }
  }

  const who = await getCurrentUser()
  const { error } = await db.from("evidence_waivers").insert({
    집행_id,
    요건_id,
    동작,
    사유: 다듬은,
    사유유형: 사유유형?.trim() || null,
    행위자: who.이름,
    행위자_인증: who.인증,
  })
  if (error) return { ok: false, error: error.message }

  const 과제_id = await 과제찾기(집행_id)
  if (과제_id) {
    revalidatePath(`/projects/${과제_id}/expenses`)
    revalidatePath(`/projects/${과제_id}/settlement`)
  }
  // 미비 카드는 단계 화면 전부에 있다(전체·신청중·수행중·사업종료).
  revalidatePath("/projects", "layout")
  return { ok: true }
}

/** 이 서류 칸을 **정상으로 본다**(면제). 사유 필수. */
export async function 증빙면제(input: {
  집행_id: number
  요건_id: number
  사유: string
  사유유형?: string | null
}): Promise<WaiverResult> {
  try {
    return await 남기기(
      Number(input.집행_id),
      Number(input.요건_id),
      "면제",
      String(input.사유 ?? ""),
      input.사유유형 ?? null,
    )
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 면제를 되돌린다(다시 미비로). 이것도 사유를 남긴다 — 되돌린 이유가 더 중요할 때가 있다. */
export async function 증빙면제해제(input: {
  집행_id: number
  요건_id: number
  사유: string
}): Promise<WaiverResult> {
  try {
    return await 남기기(
      Number(input.집행_id),
      Number(input.요건_id),
      "해제",
      String(input.사유 ?? ""),
      null,
    )
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
