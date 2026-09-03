"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser, 미인증_업로더 } from "@/lib/current-user"
import { correctEligibility } from "@/app/actions/eligibility"
import { 판정기록, 비슷한사례, 판정이력 } from "@/lib/judgment-ai.mjs"

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
 *
 * ── 확정 판정과의 연동 (2026-09-04 추가) ──────────────────────────────────
 * 사용자 지적: "판정근거남기면 그대로 판정되서 상태변경되는게 맞지않을까?" — 맞다.
 * 처음엔 이 판정을 judgment_semantic 에만 남기고 eligibility_decisions(화면 상단
 * "AI 제안만 있음 — 아직 아무도 확인 안 함" 배지)는 안 건드렸다 — 사람이 판정을
 * 남겨도 확정 상태가 그대로라 두 기능이 따로 노는 것처럼 보였다.
 *
 * eligibility-confirm.tsx·app/actions/eligibility.ts 는 mgnt3 소유 파일(644,
 * 그룹 쓰기 불가 — team-file-collision 관례)이라 고치지 않는다. 대신 여기서
 * correctEligibility() 를 그대로 재사용해 같은 검증·같은 판정계산 우선순위 1층에
 * 올라타게 한다 — 로직을 따로 베끼지 않는다.
 *
 * "요건미확인"·"해당없음"은 eligibility_decisions 스키마(db/50_program_ledger.sql)가
 * text 컬럼이라 값 자체는 받지만 correctEligibility() 의 타입엔 없다(화면에 아직
 * 노출 안 됨) — 그 두 값일 때만 같은 검증 규칙으로 직접 삽입한다.
 *
 * ⚠ "해당없음" 동기화는 처음엔 일부러 뺐다 — "eligibility_decisions 는 '우리가 지원
 *   가능한가'를 묻는 테이블이라 지원사업 자체가 아닌 공고엔 그 질문이 성립하지 않는다"고
 *   판단했다. 그런데 실사용(공고 517 — 광운대 사업 설명회)에서 그 판단이 틀렸다는 게
 *   드러났다: 사람이 "이건 지원사업이 아니다"라고 명시적으로 확정해도 화면 배지는
 *   계속 "확인필요"로 남아 — 이미 끝난 검토가 계속 "봐야 할 것"으로 보였다
 *   (사용자 지적: "브라우저에서 517 다시 확인해봐 아직도 확인필요임"). 그래서
 *   lib/queries.ts 의 판정계산()에 "해당없음"을 5번째 등급으로 추가하고, 여기서도
 *   동기화 대상에 넣었다 — "확인필요"(아직 봐야 함)와 "해당없음"(이미 봤고 볼 게
 *   아니었음)은 뜻이 다르므로 배지도 달라야 한다.
 */

export type JudgmentResult = {
  ok: boolean
  error?: string
  /** 확정 판정(eligibility_decisions)도 같이 갱신됐는지. */
  decisionSynced?: boolean
  /** 갱신을 시도했지만 실패했을 때만(전체 실패는 아니다 — 의미 학습 기록은 이미 저장됐다). */
  decisionWarning?: string
}
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

/** eligibility_decisions 와 동기화하는 값 — 5종 전부(위 주석 참고, "해당없음"도 포함). */
const 확정판정_동기화대상 = ["가능", "불가", "확인필요", "요건미확인", "해당없음"] as const

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

/**
 * 판정을 eligibility_decisions 에도 반영한다. 이미 같은 판정이 정정 없이 최신으로
 * 올라와 있으면 손대지 않는다(중복 행을 쌓지 않는다). "가능/불가/확인필요"는
 * correctEligibility() 를 그대로 쓰고, "요건미확인"만 같은 검증 규칙으로 직접 쓴다.
 */
async function 확정판정동기화(
  announcementId: number,
  판정: (typeof 확정판정_동기화대상)[number],
  사유: string,
  확정자: string,
): Promise<{ synced: boolean; error?: string }> {
  const latest = await loadLatestDecision(announcementId)
  if (latest && latest.확정_판정 === 판정 && latest.정정여부 === false) {
    return { synced: true } // 이미 그대로다 — 새로 쓸 게 없다
  }

  if (판정 === "가능" || 판정 === "불가" || 판정 === "확인필요") {
    const r = await correctEligibility({ announcementId, 판정, 유형: "직접확인", 사유, 확정자 })
    return r.ok ? { synced: true } : { synced: false, error: r.error }
  }

  // 요건미확인 · 해당없음 — 스키마는 값을 받지만(db/50_program_ledger.sql) 화면
  // (eligibility-confirm.tsx)에 아직 노출 안 된 값이라 correctEligibility() 를 못 쓴다.
  // 같은 규칙(정정 이력·사유 필수)으로 직접 삽입한다 — AI 제안이 없어도 없는 것을
  // 지어내지 않는다({} 로 둔다).
  const { error } = await db.from("eligibility_decisions").insert({
    announcement_id: announcementId,
    ai_제안: latest?.ai_제안 ?? {},
    ai_확신도: latest?.ai_확신도 ?? null,
    확정_판정: 판정,
    정정여부: true,
    정정사유_유형: "직접확인",
    정정사유: 사유,
    확정자,
  })
  if (error) return { synced: false, error: error.message }
  revalidatePath("/announcements")
  revalidatePath("/project-announcements")
  return { synced: true }
}

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
    const 사유 = input.사유?.trim() || 텍스트 // 별도 메모가 없으면 근거문장을 그대로 정정사유로 쓴다

    const r = await 판정기록(텍스트, input.판정, 답변자, {
      announcementId: input.announcementId,
      특징키: input.특징키?.trim() || undefined,
      사유: input.사유?.trim() || undefined,
    })
    if (!r.ok) return { ok: false, error: r.error }

    if ((확정판정_동기화대상 as readonly string[]).includes(input.판정)) {
      try {
        const sync = await 확정판정동기화(
          input.announcementId,
          input.판정 as (typeof 확정판정_동기화대상)[number],
          사유,
          답변자,
        )
        return { ok: true, decisionSynced: sync.synced, decisionWarning: sync.error }
      } catch (err) {
        // 의미 학습 기록은 이미 저장됐다 — 여기가 실패해도 전체를 실패로 돌리지 않는다.
        return { ok: true, decisionSynced: false, decisionWarning: err instanceof Error ? err.message : String(err) }
      }
    }
    return { ok: true, decisionSynced: false }
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

export type JudgmentHistoryRow = {
  id: number
  announcement_id: number | null
  텍스트: string
  판정: string
  특징키: string | null
  사유: string | null
  답변자: string
  created_at: string
}

/**
 * 이 공고에 실제로 남긴 판정+코멘트 이력. findSimilarJudgments() 와 달리 임베딩
 * 유사도 문턱을 거치지 않는다 — announcement_id 로 정확히 필터하므로 방금 남긴
 * 것도 빠짐없이 보인다(사용자 지적 2026-09-04: "이력 남긴거 확인이 안되냐").
 */
export async function getJudgmentHistory(
  announcementId: number,
): Promise<{ ok: boolean; rows: JudgmentHistoryRow[]; error?: string }> {
  const r = await 판정이력(announcementId)
  if (!r.ok) return { ok: false, rows: [], error: r.error }
  return { ok: true, rows: r.rows as JudgmentHistoryRow[] }
}
