import "server-only"
import { db, safeSelect } from "@/lib/db"
import type { ProjectRow } from "@/lib/queries"
import type { ShareRule } from "@/lib/funding-share"
import type { EvidenceRequirement, EvidenceFile } from "@/lib/evidence-types"

/**
 * 과제 상세(개요 · 연구비 계상 · 정산) 전용 조회.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않고 파일을 나눈 이유는 담당 때문이다 —
 *   그 파일은 공고·달력·대시보드가 같이 쓰고 있어 네 명이 동시에 연다.
 *   같은 파일을 둘이 열면 나중에 저장한 쪽이 덮어쓰고 git 이 막아주지 않는다(CLAUDE.md §1).
 *   과제·예산·정산 조회는 여기 모아 두고, 저쪽은 건드리지 않는다.
 */

/** DB 컬럼명이 한글이라 타입도 한글로 맞춘다. 매핑 계층을 하나 줄인다. */
export type ProjectBudgetRow = {
  과제_id: number
  과제명: string | null
  비목_대분류: string
  비목명: string | null
  직접비: boolean | null
  재원구분: string
  배정액: number
  집행액: number
  잔액: number
  소진율: number | null
  /** 협약·공고에서 읽은 한도(%). 비어 있으면 검증하지 않고 「확인 필요」로 둔다 — lib/verify.ts */
  한도비율: number | null
}

export type ProjectExpenseRow = {
  id: number
  일자: string | null
  거래처: string | null
  품목: unknown
  공급가액: number | null
  세액: number | null
  합계: number | null
  비목_대분류: string | null
  비목_세부항목: string | null
  재원구분: string
  결제수단: string | null
  연차: number | null
  상태: string
  rcms_제출일: string | null
}

/**
 * 과제 한 건. 상세 화면이 전부 이걸로 시작한다.
 * 없으면 rows 가 비어 돌아온다 — 404 를 띄울지 「없음」을 그릴지는 화면이 정한다.
 */
export const getProject = (id: number) =>
  safeSelect<ProjectRow>("projects", () =>
    db.from("projects").select("*").eq("id", id),
  )

/** 과제 하나의 비목별 배정·집행. */
export const getProjectBudget = (id: number) =>
  safeSelect<ProjectBudgetRow>("v_budget_status", () =>
    db.from("v_budget_status").select("*").eq("과제_id", id),
  )

/** 전 과제의 비목별 배정·집행. 예산 로스터가 과제별로 접어서 쓴다. */
export const getAllBudgets = () =>
  safeSelect<ProjectBudgetRow>("v_budget_status", () =>
    db.from("v_budget_status").select("*"),
  )

/** 과제 하나의 집행 건. 정산 탭의 「사용 건」과 「RCMS 입력 대조」가 같이 쓴다. */
export const getProjectExpenses = (id: number) =>
  safeSelect<ProjectExpenseRow>("expenses", () =>
    db
      .from("expenses")
      // ⚠ 컬럼을 나열하면 supabase-js 타입 파서가 한글 식별자에서 막힌다(queries.ts getExpenses 참고).
      .select("*")
      .eq("과제_id", id)
      .order("일자", { ascending: false }),
  )

/** 비목 코드 → 이름. 화면에서 코드가 보이면 안 된다. */
export const getCategories = () =>
  safeSelect<{ 코드: string; 이름: string; 정렬: number | null }>("categories", () =>
    db.from("categories").select("*").order("정렬"),
  )

/**
 * 재원 분담 규칙 — 정부출연금 상한 · 민간부담 현금 최소 · 현물 최대.
 *
 * 전 행을 받아 와서 고르는 일은 `pickRule()`(순수 함수)이 한다.
 * DB 쿼리로 우선순위를 표현하면(`or(...)` + `order`) 그 판단이 SQL 문자열 안에 숨는다 —
 * 「왜 이 규칙이 이겼는지」를 화면에서 말할 수 있어야 하므로 코드로 남긴다.
 * 규칙은 기관유형 6종 × (공고 + 규정)이라 전건이 수십 행을 넘지 않는다.
 */
export const getFundingShareRules = () =>
  safeSelect<ShareRule>("funding_share_rules", () =>
    db.from("funding_share_rules").select("*"),
  )

/**
 * 비목별 RCMS 증빙 요건. 전건이 30행 안쪽이라 통째로 받아 화면에서 비목별로 나눈다.
 * (요건은 과제에 종속되지 않는다 — 사업유형·공고별 예외가 생기면 그 컬럼으로 걸러진다.)
 */
export const getEvidenceRequirements = () =>
  safeSelect<EvidenceRequirement>("evidence_requirements", () =>
    db.from("evidence_requirements").select("*"),
  )

/** 과제 하나에 붙은 증빙 파일. 최근에 올린 것이 위로 온다. */
export const getProjectEvidenceFiles = (id: number) =>
  safeSelect<EvidenceFile>("project_evidence_files", () =>
    db
      .from("project_evidence_files")
      .select("*")
      .eq("과제_id", id)
      .order("업로드일시", { ascending: false }),
  )

/** 우리 회사 프로필 — 기관유형(기업규모)을 여기서 읽는다. 규칙이 기관유형별로 갈린다. */
export const getCompanyProfile = () =>
  safeSelect<{ 회사명: string | null; 기업규모: string | null; 결산연도: number }>(
    "company_profile",
    () => db.from("company_profile").select("*").order("결산연도", { ascending: false }),
  )
