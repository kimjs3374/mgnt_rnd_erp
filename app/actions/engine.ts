"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser, 미인증_업로더 } from "@/lib/current-user"
import { correctEligibility } from "@/app/actions/eligibility"
import { setAnnouncementInterest, type 관심상태 } from "@/app/actions/watchlist"
import { 판정기록 } from "@/lib/judgment-ai.mjs"

/**
 * 역방향 — 엔진이 접은 것을 사람이 다시 연다.
 *
 * 사용자 요청(2026-09-04): "불가 판정이나 해당없음 판정 받았던 건들 중에 사람이 직접
 * 확인해서 반대로 가능으로 상태변경이나 신청해서 관리할 수 있도록 하는 역방향도 구현해".
 *
 * 규칙을 믿고 쓰려면 되돌릴 길이 있어야 한다. 「불가」로 잘못 찍힌 공고는 목록에서
 * 접히기 때문에, 되돌리기가 없으면 그대로 사라진다(CLAUDE.md 설계원칙 5).
 *
 * 세 가지가 한 번에 일어난다
 *   ① eligibility_decisions 에 **사람 정정**으로 남는다(정정여부=true).
 *      → ann_sync_decisions 가 앞으로 이 공고를 **절대 덮어쓰지 않는다**(판단 우선순위 1층).
 *   ② judgment_semantic 에 근거 문장이 쌓인다 → 다음에 뜻이 비슷한 공고에서 참고된다.
 *   ③ 원하면 watchlist 에 「신청예정」으로 올라간다 → 신청 관리로 이어진다.
 */

export type EngineActionResult = { ok: boolean; error?: string }

const 되돌림_판정 = ["가능", "확인필요"] as const
export type 되돌림판정 = (typeof 되돌림_판정)[number]

export async function reverseDecision(input: {
  announcementId: number
  판정: 되돌림판정
  사유: string
  /** 되돌리면서 바로 신청 단계에 올릴지 — null 이면 관심 표시를 건드리지 않는다. */
  관심?: 관심상태 | null
}): Promise<EngineActionResult> {
  try {
    const 사유 = input.사유.trim()
    if (!사유) {
      return { ok: false, error: "왜 다르게 보는지 한 줄이 필요하다 — 그게 다음 판정의 근거가 된다." }
    }
    if (!되돌림_판정.includes(input.판정)) {
      return { ok: false, error: "되돌릴 수 있는 판정이 아니다." }
    }

    const user = await getCurrentUser()
    const 확정자 = user.인증 ? user.이름 : 미인증_업로더

    // ① 확정 판정을 사람 정정으로 덮는다. mgnt3 의 correctEligibility 를 그대로 쓴다 —
    //    같은 검증(사유 필수)·같은 이력 구조를 두 벌로 만들지 않는다.
    const r = await correctEligibility({
      announcementId: input.announcementId,
      판정: input.판정,
      유형: "직접확인",
      사유,
      확정자,
    })
    if (!r.ok) return { ok: false, error: r.error }

    // ② 의미 학습에도 남긴다. 실패해도 정정 자체를 되돌리지 않는다 — 판정은 이미 바뀌었고,
    //    학습은 그 위에 얹는 층이다(임베딩 서버가 죽어 있을 수 있다).
    try {
      await 판정기록(사유, input.판정, 확정자, {
        announcementId: input.announcementId,
        특징키: "사람_되돌림",
        사유: `엔진 판정을 사람이 뒤집음 → ${input.판정}`,
      })
    } catch {
      /* 학습 실패는 조용히 넘긴다 — 화면엔 정정 성공으로 보이는 게 맞다 */
    }

    // ③ 신청 관리로 이어 붙인다.
    if (input.관심) {
      await setAnnouncementInterest(input.announcementId, input.관심)
    }

    revalidatePath("/engine")
    revalidatePath("/announcements")
    revalidatePath("/project-announcements")
    revalidatePath(`/announcements/${input.announcementId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 되돌리지 않고 신청 단계만 표시한다(관심 → 신청예정 → 신청완료). */
export async function setInterestFromEngine(
  announcementId: number,
  상태: 관심상태 | null,
): Promise<EngineActionResult> {
  const r = await setAnnouncementInterest(announcementId, 상태)
  if (!r.ok) return { ok: false, error: r.error }
  revalidatePath("/engine")
  return { ok: true }
}

/**
 * 사람이 되돌린 이력 — 리포트에서 "규칙이 몇 번 틀렸나"를 보여주는 자리다.
 * 이 숫자가 늘면 규칙을 고쳐야 한다는 뜻이라, 숨기지 않고 그대로 센다.
 */
export type 되돌림이력 = {
  announcement_id: number
  사업명: string | null
  확정_판정: string
  정정사유: string | null
  확정자: string | null
  created_at: string
}

export async function getReversalHistory(): Promise<되돌림이력[]> {
  const { data, error } = await db
    .from("eligibility_decisions")
    .select("announcement_id,확정_판정,정정사유,확정자,created_at,announcements(사업명)")
    .eq("정정여부", true)
    .order("created_at", { ascending: false })
    .limit(30)
  if (error || !data) return []
  return (data as unknown as (Omit<되돌림이력, "사업명"> & {
    announcements: { 사업명: string } | null
  })[]).map((d) => ({
    announcement_id: d.announcement_id,
    사업명: d.announcements?.사업명 ?? null,
    확정_판정: d.확정_판정,
    정정사유: d.정정사유,
    확정자: d.확정자,
    created_at: d.created_at,
  }))
}
