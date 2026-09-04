import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 판단 이력 — 참가 계획서 문항4④("판단 이력과 AI 브리핑")가 회사 기록으로 쌓인다고
 * 말하는 그 데이터를 실제로 눈에 보이게 한다.
 *
 * app.judgment_semantic 에 사람이 남긴 「왜 그렇게 판단했나」 문장이 쌓인다(공고 상세
 * 페이지의 JudgmentNote, Slack answer_eligibility_question 둘 다 여기로 들어간다).
 * 이 파일은 그걸 공고 단위가 아니라 **회사 전체 단위**로 최근 것부터 모아 보여주려고
 * 새로 뺐다 — lib/queries.ts 는 네 명이 같이 쓰는 파일이라 직접 건드리지 않는다
 * (queries-programs.ts 와 같은 이유, 그 파일 상단 주석 참고).
 */
export type JudgmentHistoryRow = {
  id: number
  announcement_id: number
  판정: string
  특징키: string | null
  사유: string | null
  답변자: string
  created_at: string
  /** 임베드 방향에 따라 객체·배열 둘 다 올 수 있어 화면에서 정규화한다. */
  announcements: { 사업명: string; 출처: string } | { 사업명: string; 출처: string }[] | null
}

export const getRecentJudgmentHistory = (limit = 8) =>
  safeSelect<JudgmentHistoryRow>("judgment_semantic", () =>
    db
      .from("judgment_semantic")
      .select("*, announcements(*)")
      .not("사유", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  )
