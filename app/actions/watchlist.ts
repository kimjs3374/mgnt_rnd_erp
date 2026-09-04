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

/**
 * 신청 단계까지 올라간 공고인가. **지우기 전에 반드시 본다.**
 *
 * 2026-09-04 사용자 지적: "관심공고(별)을 클릭하면 신청이 취소되버리는 문제".
 * 별은 표 안의 작은 버튼이고 줄을 누르면 상세로 넘어가는 자리라 스치듯 눌린다.
 * 관심을 지우는 건 되돌리기 쉽지만, **신청 표시를 지우는 건 「한 일을 안 한 일로」**
 * 만드는 것이라 무게가 다르다. 올린 자리(공고 상세의 ApplyStatus)에서만 내린다.
 */
async function 신청단계인가(참조_id: number): Promise<{ 단계: string | null; error?: string }> {
  const { data, error } = await db
    .from("watchlist")
    .select("*")
    .eq("종류", "공고")
    .eq("참조_id", 참조_id)
    .maybeSingle()
  if (error) return { 단계: null, error: error.message }
  const 상태 = (data as { 상태?: string | null } | null)?.상태 ?? null
  return { 단계: 상태 === "신청예정" || 상태 === "신청완료" ? 상태 : null }
}

const 신청단계_안내 = (단계: string) =>
  `「${단계}」로 표시된 공고입니다. 별로는 지워지지 않습니다 — 공고 상세에서 내리세요.`

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
      // 공고의 신청 표시는 여기서 안 지운다(위 `신청단계인가` 주석 참고).
      // 「사업」 종류는 단계 개념이 없어 그대로 지운다.
      if (종류 === "공고") {
        const { 단계, error: 조회오류 } = await 신청단계인가(참조_id)
        if (조회오류) return { ok: false, error: 조회오류 }
        if (단계) return { ok: false, error: 신청단계_안내(단계) }
      }
      const { error } = await db
        .from("watchlist")
        .delete()
        .eq("종류", 종류)
        .eq("참조_id", 참조_id)
      if (error) return { ok: false, error: error.message }
    }

    // 관심은 대시보드의 달력·공고 보드와 두 공고 탐색 화면(지원사업·과제사업) 전부를 바꾼다.
    // ⚠ 2026-09-03 추가: 공고 탐색 목록에 별 토글이 생기면서 project-announcements 도
    //   빠뜨리면 안 되게 됐다 — 예전엔 지원사업 쪽에서만 관심 표시를 썼다.
    revalidatePath("/dashboard")
    revalidatePath("/announcements")
    revalidatePath("/project-announcements")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 공고 관심 단계 — "관심"(목록의 별) → "신청예정" → "신청완료"(상세 페이지 버튼).
 * 종류가 늘어난 게 아니라, 이미 관심 표시한 공고 중 진짜 신청 진행 단계만 표시하는
 * 것뿐이다(사용자 요청, 2026-09-04: "목록 별=관심, 상세 페이지 버튼=신청예정·신청완료").
 * 값을 null 로 주면 표시 자체를 지운다(같은 버튼을 다시 눌러 취소하는 용도).
 *
 * toggleWatch 와 별도 함수인 이유 — toggleWatch 는 "사업"(대시보드의 관심 공고 등)에서도
 * 켜고 끄는 단순 on/off 로 계속 쓰인다. 여기는 "공고" 전용 단계만 다룬다.
 */
export type 관심상태 = "관심" | "신청예정" | "신청완료"
const 관심상태목록: readonly 관심상태[] = ["관심", "신청예정", "신청완료"]

export async function setAnnouncementInterest(
  참조_id: number,
  상태: 관심상태 | null,
): Promise<ActionResult> {
  if (!Number.isInteger(참조_id) || 참조_id <= 0) {
    return { ok: false, error: "참조 id 가 올바르지 않다." }
  }

  try {
    if (상태 === null) {
      const { error } = await db
        .from("watchlist")
        .delete()
        .eq("종류", "공고")
        .eq("참조_id", 참조_id)
      if (error) return { ok: false, error: error.message }
    } else {
      if (!관심상태목록.includes(상태)) {
        return { ok: false, error: `알 수 없는 상태: ${상태}` }
      }
      const { error } = await db
        .from("watchlist")
        .upsert({ 종류: "공고", 참조_id, 상태 }, { onConflict: "종류,참조_id" })
      if (error) return { ok: false, error: error.message }
    }

    revalidatePath("/dashboard")
    revalidatePath("/announcements")
    revalidatePath("/project-announcements")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
