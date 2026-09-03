import "server-only"
import { db, safeSelect } from "@/lib/db"

// DB 컬럼명이 한글이라 타입도 한글로 맞춘다. 매핑 계층을 하나 줄인다.

export type LedgerRow = {
  id: number
  사업명: string
  기관: string | null
  사업유형: string | null
  공고일: string | null
  마감일: string | null
  d_day: number | null
  지원금액: number | null
  사용금액: number
  집행률: number | null
  신청일: string | null
  선정결과: string | null
  상태: string
  미처리점검: number
  미확보서류: number
  비고: string | null
}

export const getLedger = () =>
  safeSelect<LedgerRow>("v_program_ledger", () =>
    db.from("v_program_ledger").select("*").order("id"),
  )

export type BudgetRow = {
  과제_id: number
  비목_대분류: string
  비목명: string | null
  재원구분: string
  배정액: number
  집행액: number
  잔액: number
  소진율: number | null
}

export const getBudget = () =>
  safeSelect<BudgetRow>("v_budget_status", () =>
    db.from("v_budget_status").select("*"),
  )

export type ExpenseRow = {
  id: number
  일자: string | null
  거래처: string | null
  합계: number | null
  품목: unknown
  비목_대분류: string | null
  비목_세부항목: string | null
  ai_확신도: number | null
  상태: string
}

export const getExpenses = () =>
  safeSelect<ExpenseRow>("expenses", () =>
    db
      .from("expenses")
      // ⚠ 컬럼을 나열하면 supabase-js 의 타입 파서가 한글 식별자에서 막힌다.
      //    런타임이 아니라 컴파일 문제라 * 로 받고 타입으로 좁힌다.
      .select("*")
      .order("일자", { ascending: false })
      .limit(200),
  )

export type DocStatusRow = {
  코드: string
  이름: string
  발급일: string | null
  결산연도: number | null
  상태: string
  만료일: string | null
}

export const getDocuments = () =>
  safeSelect<DocStatusRow>("v_document_status", () =>
    db.from("v_document_status").select("*"),
  )

export type CompanyRow = {
  결산연도: number
  매출액: number | null
  매출증가율: number | null
  부채비율: number | null
  자본전액잠식: boolean
  rnd_집약도: number | null
  기업부설연구소: boolean
  ksic_코드: string[] | null
  종업원수: number | null
  출처_문서: string | null
}

export const getCompany = () =>
  safeSelect<CompanyRow>("company_profile", () =>
    db.from("company_profile").select("*").order("결산연도", { ascending: false }),
  )

export type SettlementRow = {
  과제_id: number
  과제명: string
  연차: number | null
  집행건수: number
  검토대기: number
  확정: number
  제출: number
  정산완료: number
  반려: number
  집행액: number
  증빙미비건수: number
}

export const getSettlement = () =>
  safeSelect<SettlementRow>("v_settlement_status", () =>
    db.from("v_settlement_status").select("*"),
  )

export type AnnouncementRow = {
  id: number
  사업명: string
  소관부처: string | null
  전문기관: string | null
  지역: string | null
  접수시작: string | null
  접수종료: string | null
  마감유형: string
  파싱상태: string
}

export const getAnnouncements = () =>
  safeSelect<AnnouncementRow>("announcements", () =>
    db
      .from("announcements")
      .select("*")
      .order("id")
      .limit(100),
  )

/**
 * 공고 확인 보드 — 대시보드의 「공고 확인」 탭이 읽는다.
 * app.v_announcement_board 뷰 하나만 읽는다. 구분·신규·d_day 는 DB 가 계산해서 준다.
 * 「오늘」 판정을 브라우저 시계로 하지 않는 이유: 심사장 PC 의 시간대를 믿을 수 없고,
 * 서버 DB 는 UTC 라 뷰 안에서 Asia/Seoul 로 환산해 두었다.
 */
export type BoardRow = {
  id: number
  출처: string
  출처_id: string | null
  사업명: string
  기관: string | null
  지역: string | null
  사업유형: string | null
  사업유형명: string | null
  구분: string // 과제 | 지원사업 | 미분류
  공고일: string | null
  수집일: string | null
  날짜출처: string // 공고일 | 수집일
  기준일: string | null
  신규: boolean
  접수시작: string | null
  접수종료: string | null
  마감유형: string
  d_day: number | null
  파싱상태: string
  공고문_url: string | null
}

export const getAnnouncementBoard = () =>
  safeSelect<BoardRow>("v_announcement_board", () =>
    db
      .from("v_announcement_board")
      // 새로 올라온 것이 위로. 그다음 마감이 임박한 순.
      .select("*")
      .order("기준일", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
  )

export type ProjectRow = {
  id: number
  과제코드: string | null
  과제명: string
  부처: string | null
  전문기관: string | null
  사업명: string | null
  협약번호: string | null
  사업유형: string | null
  시작일: string | null
  종료일: string | null
  연차: number | null
  총사업비: number | null
  정부지원금: number | null
  기관부담_현금: number | null
  기관부담_현물: number | null
  상태: string
}

/**
 * 과제사업 — 선정되어 수행된(수행 중인) 과제의 수행 정보.
 * 「지원사업」이 공고→신청→선정 관점의 뷰라면, 이건 협약 이후 과제 자체의 마스터 정보다.
 * 시작일이 있는 행만 「수행」으로 본다 — 아직 신청·심사 단계인 건 지원사업 대장에서 본다.
 */
export const getProjects = () =>
  safeSelect<ProjectRow>("projects", () =>
    db
      .from("projects")
      // ⚠ 컬럼을 나열하면 supabase-js 의 타입 파서가 한글 식별자에서 막힌다(getExpenses 참고).
      //    런타임이 아니라 컴파일 문제라 * 로 받고 타입으로 좁힌다.
      .select("*")
      .not("시작일", "is", null)
      .order("시작일", { ascending: false }),
  )

/** 원화 표기. null 은 「—」로 둔다. 0 과 「모름」을 구분한다. */
export const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")
