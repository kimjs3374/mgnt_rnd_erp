import "server-only"
import { db, safeSelect } from "@/lib/db"
import type { RuleDocument, 공고선택지, 사업유형선택지 } from "@/lib/rule-types"

/**
 * 규정 문서함 조회.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다 — 그 파일은 공고·달력·대시보드가 같이 써서 네 명이 동시에 연다.
 *   같은 파일을 둘이 열면 나중에 저장한 쪽이 덮어쓰고 git 이 막아주지 않는다(CLAUDE.md §1).
 *   실제로 두 번 났다(`_팀로그/memory/queries-ts-concurrent-save.md`).
 */

/** 규정 문서 전부. 화면이 적용범위별로 묶는다. */
export const getRuleDocuments = () =>
  safeSelect<RuleDocument>("rule_documents", () =>
    db.from("rule_documents").select("*").order("업로드일시", { ascending: false }),
  )

/**
 * 고르는 칸에 채울 공고 목록. 최근 것부터 — 규정을 붙일 공고는 대개 방금 본 공고다.
 *
 * ⚠ `select("id,사업명,…")` 로 컬럼을 추려 쓰지 않는다. supabase-js 의 select 타입 파서가
 *   **한글 컬럼명을 식별자로 못 읽어** `ParserError` 로 컴파일이 깨진다(실측 09-03).
 *   그래서 이 저장소는 전부 `select("*")` 를 쓴다. 컬럼 추리기는 화면에서 한다.
 */
export const getAnnouncementChoices = () =>
  safeSelect<공고선택지>("announcements", () =>
    db
      .from("announcements")
      .select("*")
      .order("공고일", { ascending: false, nullsFirst: false })
      .limit(200),
  )

export const getSchemeChoices = () =>
  safeSelect<사업유형선택지>("funding_schemes", () => db.from("funding_schemes").select("*").order("코드"))

/**
 * **한 과제에 적용되는 규정 전부.** 공고 > 사업유형 > 공통 세 층을 한 번에 모은다.
 *
 * 이게 이 표를 `funding_share_rules` 와 같은 축으로 잡은 이유다 — 축이 어긋나면
 * 「이 과제의 연구수당 한도가 20% 인 근거」를 화면에서 한 번에 못 연다.
 * 우선순위대로(공고가 위) 정렬해서 돌려준다.
 */
export async function getRulesForProject(공고_id: number | null, 사업유형: string | null) {
  const { rows, error } = await getRuleDocuments()
  if (error) return { rows: [] as RuleDocument[], error }
  const 순위 = { 공고: 0, 사업유형: 1, 공통: 2 } as const
  const 걸리는것 = rows.filter(
    (r) =>
      (r.적용범위 === "공고" && 공고_id != null && r.announcement_id === 공고_id) ||
      (r.적용범위 === "사업유형" && 사업유형 != null && r.사업유형 === 사업유형) ||
      r.적용범위 === "공통",
  )
  걸리는것.sort((a, b) => 순위[a.적용범위] - 순위[b.적용범위])
  return { rows: 걸리는것, error: null as string | null }
}
