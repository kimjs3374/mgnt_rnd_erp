"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"

/**
 * 자격판정 확인 · 정정 서버 액션 — `app/actions/expenses.ts`(비목 확정·정정)와
 * 같은 골격이다. 사용자 요청(2026-09-03): "관심공고는 자동으로 뜨지만, 우리가
 * 확인했을 때 정말 가능한 공고는 체크할 수 있게" — AI 제안(자격판정)에 사람이
 * 도장을 찍는 자리다.
 *
 * ★ 이 프로젝트의 판단 우선순위 1층("정정 이력")이 자격판정에도 적용되는 지점이다.
 *   AI가 낸 판정을 사람이 그대로 받아들이면 「확인」, 다르게 보면 「정정」(사유 필수) —
 *   그 한 줄이 다음에 같은 공고를 다시 볼 때 최우선으로 쓰인다(lib/queries.ts 의
 *   판정계산 이 eligibility_decisions 최신 행을 최우선으로 보는 이유가 이것이다).
 */

export type ActionResult = { ok: boolean; error?: string }

const 정정사유_유형 = ["회사정보변경", "판독오류", "해석차이", "직접확인"] as const
type 정정유형 = (typeof 정정사유_유형)[number]

async function loadLatestDecision(announcementId: number) {
  const { data, error } = await db
    .from("eligibility_decisions")
    .select("*")
    .eq("announcement_id", announcementId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Record<string, unknown> | null
}

function revalidateAll() {
  revalidatePath("/announcements")
  revalidatePath("/project-announcements")
}

/** [이대로 확인] — AI 판정을 사람이 그대로 받아들인다. AI 제안이 아예 없으면 확인할 게 없다. */
export async function confirmEligibility(
  announcementId: number,
  확정자: string,
): Promise<ActionResult> {
  try {
    const latest = await loadLatestDecision(announcementId)
    if (!latest) {
      return { ok: false, error: "아직 AI 판정이 없다. 채점이 먼저 돌아야 확인할 수 있다." }
    }

    const { error } = await db.from("eligibility_decisions").insert({
      announcement_id: announcementId,
      ai_제안: latest.ai_제안,
      ai_확신도: latest.ai_확신도,
      확정_판정: latest.확정_판정,
      정정여부: false,
      확정자,
    })
    if (error) return { ok: false, error: error.message }

    revalidateAll()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * [판정 정정] — 사람이 AI 판정과 다르게 확정한다(또는 AI 제안이 아예 없어도 사람이
 * 직접 판정한다). **사유가 없으면 저장되지 않는다** — 화면·서버·DB(chk_elig_정정사유)
 * 세 겹으로 막는다.
 */
export async function correctEligibility(input: {
  announcementId: number
  판정: "가능" | "불가" | "확인필요"
  유형: string
  사유: string
  확정자: string
}): Promise<ActionResult> {
  try {
    const 사유 = input.사유.trim()

    if (!정정사유_유형.includes(input.유형 as 정정유형)) {
      return { ok: false, error: "정정 사유 유형을 선택하라." }
    }
    if (!사유) {
      return { ok: false, error: "왜 그렇게 판단했는지 한 줄이 필요하다. 이게 이 시스템의 전부다." }
    }

    const latest = await loadLatestDecision(input.announcementId)
    if (latest && latest.확정_판정 === input.판정 && latest.정정여부 === false) {
      return { ok: false, error: "판정이 이미 그대로다. 바꿀 것이 없으면 [이대로 확인]을 쓰라." }
    }

    // AI 제안이 아예 없는 공고(요건미확인)를 사람이 직접 판정하는 경우가 있다 —
    // ai_제안 은 NOT NULL 컬럼이라 빈 객체로 채운다. 없는 AI 의견을 지어내지 않는다.
    const { error } = await db.from("eligibility_decisions").insert({
      announcement_id: input.announcementId,
      ai_제안: latest?.ai_제안 ?? {},
      ai_확신도: latest?.ai_확신도 ?? null,
      확정_판정: input.판정,
      정정여부: true,
      정정사유_유형: input.유형,
      정정사유: 사유,
      확정자: input.확정자,
    })
    if (error) return { ok: false, error: error.message }

    revalidateAll()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
