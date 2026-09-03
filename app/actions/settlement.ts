"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

/**
 * 정산 마감 설정 — 기준일·이동방식·그 달만 다른 날. (2026-09-04 사용자 지시)
 *
 * 「회계 일정은 매번 달라진다」에 대한 답이 **세 층**이다:
 *   ① 기본 규칙(매월 N일 · 쉬는 날 처리)  ② 그 달만 다르게  ③ 공휴일 목록
 * ①②는 여기서 고치고 ③은 `app.holidays` 를 손본다(`db/114`).
 *
 * ⚠ 여기도 AI 는 없다. 사람이 넣은 값을 그대로 저장하고 날짜 계산만 코드가 한다.
 */

export type 결과 = { ok: boolean; error?: string }

const 정수 = (v: unknown) => {
  const n = Math.round(Number(String(v ?? "").trim()))
  return Number.isFinite(n) ? n : NaN
}
const 날짜 = (v: unknown) => {
  const s = String(v ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** 기본 규칙을 바꾼다. 한 줄짜리 표라 항상 id=1 을 덮어쓴다. */
export async function saveSettlementRule(입력: {
  기준일: number | string
  이동: string
  비고?: string | null
}): Promise<결과> {
  try {
    const 기준일 = 정수(입력.기준일)
    if (!Number.isFinite(기준일) || 기준일 < 1 || 기준일 > 31) {
      return { ok: false, error: "기준일은 1~31 사이여야 합니다." }
    }
    if (!["앞", "뒤", "그대로"].includes(String(입력.이동))) {
      return { ok: false, error: "쉬는 날 처리 방식이 이상합니다." }
    }
    const user = await getCurrentUser()
    const { error } = await db.from("settlement_rule").upsert(
      {
        id: 1,
        기준일,
        이동: 입력.이동,
        비고: String(입력.비고 ?? "").trim() || null,
        바꾼이: user.이름,
        바꾼일시: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    if (error) return { ok: false, error: error.message }

    revalidatePath("/projects/all")
    revalidatePath("/settlement")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 그 달만 마감일을 따로 잡는다. **규칙보다 이게 이긴다.**
 * 같은 달을 다시 저장하면 덮어쓴다(달마다 하나면 충분하다).
 */
export async function saveSettlementOverride(입력: {
  연월: string
  마감일: string
  사유?: string | null
}): Promise<결과> {
  try {
    const 연월 = String(입력.연월 ?? "").slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(연월)) return { ok: false, error: "연월이 이상합니다 (예: 2026-09)." }
    const 마감일 = 날짜(입력.마감일)
    if (!마감일) return { ok: false, error: "마감일을 넣어야 합니다." }
    // 그 달의 날이어야 한다 — 9월 마감을 10월 날짜로 잡아 두면 아무도 못 찾는다.
    if (마감일.slice(0, 7) !== 연월) {
      return { ok: false, error: `${연월} 의 마감일은 그 달 안의 날이어야 합니다.` }
    }

    const user = await getCurrentUser()
    const { error } = await db.from("settlement_overrides").upsert(
      {
        연월,
        마감일,
        사유: String(입력.사유 ?? "").trim() || null,
        바꾼이: user.이름,
        바꾼일시: new Date().toISOString(),
      },
      { onConflict: "연월" },
    )
    if (error) return { ok: false, error: error.message }

    revalidatePath("/projects/all")
    revalidatePath("/settlement")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 그 달 지정을 지운다 — 규칙대로 돌아간다. */
export async function deleteSettlementOverride(연월: string): Promise<결과> {
  try {
    if (!/^\d{4}-\d{2}$/.test(String(연월 ?? ""))) return { ok: false, error: "연월이 이상합니다." }
    const { error } = await db.from("settlement_overrides").delete().eq("연월", 연월)
    if (error) return { ok: false, error: error.message }
    revalidatePath("/projects/all")
    revalidatePath("/settlement")
    revalidatePath("/dashboard")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
