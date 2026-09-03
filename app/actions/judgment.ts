"use server"

import { getCurrentUser, 미인증_업로더 } from "@/lib/current-user"
import { 판정기록, 비슷한사례 } from "@/lib/judgment-ai.mjs"

/**
 * 판정 + 코멘트를 의미 학습(judgment_semantic)에 남긴다 — LLM 을 부르지 않는다.
 *
 * app/actions/eligibility.ts(가능/불가/확인필요 확정·정정)와 다른 층이다.
 * eligibility_decisions 는 "이 공고의 확정된 판정"을 남기고, 여기(judgment_semantic)는
 * "왜 그렇게 판단했는지 — 그 문장" 을 임베딩해서 **다음 공고에서 문구가 달라도**
 * 뜻이 비슷하면 참고 사례로 찾아지게 한다(bot/semantic_learn.py, 2026-09-04).
 *
 * ⚠ 텍스트는 판정 결과("불가")가 아니라 **판정의 근거가 된 문장**이어야 한다.
 *   공고문에서 그대로 인용하거나, 없으면 사람이 직접 쓴 판단 근거 문장을 받는다.
 */

export type JudgmentResult = { ok: boolean; error?: string }
export type SimilarJudgment = {
  id: number
  announcement_id: number | null
  텍스트: string
  판정: string
  특징키: string | null
  사유: string | null
  답변자: string
  created_at: string
  유사도: number
}

const 판정_선택지 = ["가능", "불가", "확인필요", "요건미확인", "해당없음"] as const
export type 판정값 = (typeof 판정_선택지)[number]

export async function submitJudgmentComment(input: {
  announcementId: number
  텍스트: string
  판정: 판정값
  특징키?: string
  사유?: string
}): Promise<JudgmentResult> {
  try {
    const 텍스트 = input.텍스트.trim()
    if (!텍스트) {
      return { ok: false, error: "판정의 근거가 된 문장을 적어야 한다 — 판정 결과 자체 말고." }
    }
    if (!판정_선택지.includes(input.판정)) {
      return { ok: false, error: "판정 값이 올바르지 않다." }
    }

    const user = await getCurrentUser()
    const 답변자 = user.인증 ? user.이름 : 미인증_업로더

    const r = await 판정기록(텍스트, input.판정, 답변자, {
      announcementId: input.announcementId,
      특징키: input.특징키?.trim() || undefined,
      사유: input.사유?.trim() || undefined,
    })
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 뜻이 비슷한 과거 판정 사례를 찾는다. 정답을 대신 내지 않는다 — 참고 사례만 준다. */
export async function findSimilarJudgments(
  text: string,
): Promise<{ ok: boolean; matches: SimilarJudgment[]; error?: string }> {
  const q = text.trim()
  if (!q) return { ok: true, matches: [] }
  const r = await 비슷한사례(q)
  if (!r.ok) return { ok: false, matches: [], error: r.error }
  return { ok: true, matches: r.matches as SimilarJudgment[] }
}
