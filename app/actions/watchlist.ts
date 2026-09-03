"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"

/**
 * 관심 표시 토글.
 *
 * 「이건 내가 챙겨보겠다」고 사람이 손으로 누른 것 — 판단 이력의 가장 가벼운 형태다.
 * 눌린 공고의 마감일이 달력에 파란색으로 올라간다.
 *
 * ⚠ 로그인이 아직 없어서 조직 공용이다. 누가 눌렀는지는 남지 않는다.
 *   로그인이 붙으면 watchlist 에 사용자 컬럼을 더하고 여기서 채운다.
 */

export type ActionResult = { ok: boolean; error?: string }

const 종류목록 = ["공고", "사업"] as const
type 종류 = (typeof 종류목록)[number]

export async function toggleWatch(
  종류: string,
  참조_id: number,
  켠다: boolean,
): Promise<ActionResult> {
  // 화면에서 막고 여기서 또 막는다. DB 의 CHECK 제약이 마지막으로 막는다.
  if (!종류목록.includes(종류 as 종류)) {
    return { ok: false, error: `알 수 없는 종류: ${종류}` }
  }
  if (!Number.isInteger(참조_id) || 참조_id <= 0) {
    return { ok: false, error: "참조 id 가 올바르지 않다." }
  }

  try {
    if (켠다) {
      // 이미 있으면 아무 일도 안 일어난다(unique 제약). 두 번 눌러도 안전하다.
      const { error } = await db
        .from("watchlist")
        .upsert({ 종류, 참조_id }, { onConflict: "종류,참조_id" })
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await db
        .from("watchlist")
        .delete()
        .eq("종류", 종류)
        .eq("참조_id", 참조_id)
      if (error) return { ok: false, error: error.message }
    }

    // 관심은 대시보드의 달력과 공고 보드 양쪽을 바꾼다.
    revalidatePath("/dashboard")
    revalidatePath("/announcements")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
