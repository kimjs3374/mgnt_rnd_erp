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

export type AnnouncementSummary = {
  지원분야: string | null
  지원대상: string | null
  지원규모: string | null
  접수방법: string | null
  문의처: string | null
  사업요약: string | null
  ai_확신도: number | null
}

export type AnnouncementRow = {
  id: number
  출처: string
  출처_id: string | null
  사업명: string
  소관부처: string | null
  전문기관: string | null
  지역: string | null
  접수시작: string | null
  접수종료: string | null
  마감유형: string
  공고문_파일명: string | null
  공고문_url: string | null
  /** 원본 서버 링크가 나중에 끊겨도 살아있는, 우리 Supabase Storage 사본(db/92_ann_storage.sql). */
  /** 다른 화면(lib/queries-programs.ts 등)은 아직 이 필드를 안 채운다 — optional 로 둬서 안 깨지게 한다. */
  공고문_bucket_url?: string | null
  파싱상태: string
  /** 요건을 안 읽었으면 요건미확인, 읽었지만 확정이 없으면 확인필요. 판정 등급 5종 — page.tsx 설명 참고.
   *  "해당없음"은 2026-09-04 추가 — 행사·설명회 등 지원사업 자체가 아니라고 사람이 확정한 경우.
   *  "확인필요"와 다르다: 확인필요는 "아직 봐야 함", 해당없음은 "이미 봤고 볼 게 아니었음". */
  자격판정: "가능" | "불가" | "확인필요" | "요건미확인" | "해당없음"
  /** LLM 이 회사 프로필과 대조해 매긴 0~100점. 아직 판정 전이면 null. */
  자격판정_점수?: number | null
  자격판정_근거?: string[]
  /** LLM 판정의 확신도(0~1). 0.70 미만이면 자격판정이 자동으로 「확인필요」로 내려간다. */
  자격판정_확신도?: number | null
  /** 회사 프로필에 값이 없어 LLM이 판단하지 못한 항목 — "확인필요"의 이유를 구체적으로 짚어준다. */
  자격판정_확인필요항목?: string[]
  /**
   * 확신도가 낮아 「확인필요」로 강제 하향되기 전, LLM이 원래 냈던 판정(가능/불가).
   * 하향 안 됐으면 null(원판정=확정판정이라 따로 보여줄 필요가 없다는 뜻).
   */
  자격판정_원판정?: string | null
  /**
   * 사람이 이 판정을 확인·정정했는지 — CLAUDE.md 판단 우선순위 1층("정정 이력")이
   * 자격판정에도 적용된 자리다(사용자 요청 2026-09-03: "우리가 확인했을 때 정말
   * 가능한 공고는 체크할 수 있게"). null 이면 AI 제안만 있고 아직 아무도 안 봤다는 뜻.
   */
  자격판정_정정여부?: boolean | null
  자격판정_확정자?: string | null
  자격판정_확정일시?: string | null
  /** 재공고·연장공고가 다른 출처_id로 다시 올라온 후보. 자동 병합하지 않는다 — 화면이 후보로만 보여준다. */
  중복후보: boolean
  /**
   * 사람이 손으로 누른 관심 표시(app.watchlist, 종류='공고') — 자격판정(계산·AI)과는
   * 완전히 별개다. 자격판정은 "회사 프로필과 맞는가"를 기계가 판단한 것이고, 이건
   * "내가 챙겨보겠다"고 사람이 정한 것이다(사용자 요청 2026-09-03: "사람이 직접 보고
   * 관심 있으면 별을 체크"). 기본은 optional — 이 필드를 안 채우는 화면은 조용히 false 취급.
   */
  관심?: boolean
  /**
   * 관심 표시의 단계 — "관심"(챙겨보는 중) 또는 "신청예정"(신청하기로 정함). 별 하나가
   * 이 둘을 순환한다(사용자 요청 2026-09-04: "관심 공고, 신청 예정 구분"). 표시 안 함(null)은
   * 관심 자체를 안 눌렀다는 뜻 — `관심` 이 false 인 것과 같다.
   */
  관심상태?: "관심" | "신청예정" | "신청완료" | null
  /**
   * 상세 패널용 요약. 기업마당·K-Startup 등 오픈API가 직접 주는 원본 필드
   * (announcements.지원분야·지원대상·문의처·요약, lib/sources.mjs)가 있으면 그게 진짜라 우선한다 —
   * IRIS 처럼 API가 구조화 필드를 안 주는 출처만 본문에서 LLM이 뽑은 값(ann_summary)으로 채운다.
   */
  요약: AnnouncementSummary | null
}

type RawAnnouncementRow = Omit<
  AnnouncementRow,
  | "자격판정"
  | "자격판정_점수"
  | "자격판정_근거"
  | "자격판정_확신도"
  | "자격판정_확인필요항목"
  | "자격판정_원판정"
  | "자격판정_정정여부"
  | "자격판정_확정자"
  | "자격판정_확정일시"
  | "중복후보"
  | "요약"
> & {
  지원분야: string | null
  지원대상: string | null
  문의처: string | null
  요약: string | null
  ann_requirements: { id: number }[]
  eligibility_decisions: {
    확정_판정: string
    created_at: string
    ai_확신도: number | null
    ai_제안: { 점수?: number; 근거?: string[]; 확인필요항목?: string[]; 원판정?: string | null } | null
    정정여부: boolean
    확정자: string | null
  }[]
  // ann_summary 는 UNIQUE(announcement_id) 라 PostgREST 가 배열이 아니라 단일 객체(to-one)로
  // 임베드한다 — ann_requirements·eligibility_decisions(유니크 없음, 배열)와 다르다. 실측 확인.
  ann_summary: AnnouncementSummary | null
}

/**
 * 접수가 이미 끝났는지 — **마감유형이 `dated`(날짜 마감)일 때만** 따진다. 상시·소진시·
 * 완료시 공고는 마감일이 없으므로 지나갈 수가 없다.
 *
 * lib/queries-programs.ts 에 같은 함수가 있다 — 그 파일이 이 파일을 안 건드리는 방침이라
 * (그 파일 맨 위 주석) 4줄짜리 순수 계산을 양쪽에 둔다. 규칙은 bot/ann_score.py 의 첫
 * 게이트(`put("접수마감", 남음 >= 0, …, 신뢰도 1.0)`)와 같다 — 셋이 어긋나면 안 된다.
 */
function 접수마감됨(접수종료: string | null, 마감유형: string | null): boolean {
  if (!접수종료) return false
  if ((마감유형 ?? "dated") !== "dated") return false
  return 접수종료 < new Date().toISOString().slice(0, 10)
}

/**
 * 자격판정 등급 계산 — 우선순위: ① 확정 판정(eligibility_decisions, LLM 점수든 사람
 * 확정이든 최신 것) ② 요건은 읽었는데 확정이 없다(ann_requirements 만 있음) ③ 요건미확인.
 *
 * ⚠ 순서가 중요하다. 예전엔 ann_requirements 가 없으면 무조건 「요건미확인」을 먼저
 *   반환했다 — 그러면 scripts/score-eligibility.mjs 가 본문만으로 점수를 매겨
 *   eligibility_decisions 에 넣어도 화면은 그 점수를 무시하고 항상 「요건미확인」만
 *   보여줬다(실측: IRIS 15건 중 13건이 그랬다 — ann_requirements 추출은 아직 2건뿐인데
 *   eligibility_decisions 점수는 그보다 많이 매겨져 있었다). lib/queries-programs.ts 의
 *   판정계산(지원사업 쪽, 팀원 작성)은 이미 이 순서가 맞았다 — 그쪽과 맞춘다.
 */
function 판정계산(row: RawAnnouncementRow): AnnouncementRow["자격판정"] {
  const 판정 = 판정사슬(row)
  // 접수가 끝났으면 자격을 따질 것도 없다 — 신청 자체가 불가능하다(lib/queries-programs.ts
  // 의 판정계산과 같은 게이트다. 목록과 상세가 같은 공고를 다르게 말하면 안 된다).
  // 사슬보다 **뒤**에 두는 이유는 「해당없음」만은 살려야 하기 때문이다 — 그건 "애초에
  // 지원사업이 아니다"라는 뜻이라 마감 여부와 축이 다르다.
  if (판정 !== "해당없음" && 접수마감됨(row.접수종료, row.마감유형)) return "불가"
  return 판정
}

function 판정사슬(row: RawAnnouncementRow): AnnouncementRow["자격판정"] {
  if (row.eligibility_decisions.length > 0) {
    const 최신 = row.eligibility_decisions.reduce((a, b) =>
      a.created_at > b.created_at ? a : b,
    )
    const 판정 = 최신.확정_판정
    // "해당없음"은 그대로 통과시킨다(2026-09-04) — 사람이 "이건 지원사업이 아니다"라고
    // 명시적으로 확정한 것까지 "확인필요"로 뭉개면, 이미 처리한 건이 계속 "봐야 할 것"으로
    // 남는다(실사용 신고: 공고 517 — 행사 안내인데 판정을 남겨도 배지가 안 바뀜).
    // 규칙엔진이 낸 등급을 그대로 쓴다. 「요건미확인」을 「확인필요」로 올려버리면
    // "본문을 못 읽었다"와 "읽었는데 사람이 봐야 한다"가 한 칸에 섞인다 —
    // 더 나쁜 건, 결정 행이 아예 없을 때 아래 ③ 단계가 지역·대상만 보고 「가능」을
    // 준다는 것이다(실측 2026-09-04: 엔진 가능 10건인데 화면엔 30건이 떴다).
    if (판정 === "가능" || 판정 === "불가" || 판정 === "해당없음" || 판정 === "요건미확인") {
      return 판정
    }
    return "확인필요"
  }
  if (row.ann_requirements.length > 0) return "확인필요"
  return "요건미확인"
}

/**
 * 사업명에서 공백·괄호·꼬리말(공고/재공고/모집 등)을 지우고 같은 소관부처 안에서
 * 남은 글자가 완전히 같으면 재공고·연장공고 후보로 본다. 오탐을 줄이려 완전일치만 본다 —
 * 비슷하다고 병합하면 서로 다른 공고를 하나로 지워버릴 수 있다. 자동 병합은 하지 않는다.
 */
function 정규화(사업명: string): string {
  return 사업명
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(공고|재공고|수정공고|모집|안내)+$/g, "")
}

function 중복후보계산(rows: RawAnnouncementRow[]): Set<number> {
  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const key = 정규화(r.사업명)
    if (!key) continue
    const list = groups.get(`${r.소관부처 ?? ""}::${key}`) ?? []
    list.push(r.id)
    groups.set(`${r.소관부처 ?? ""}::${key}`, list)
  }
  const 중복 = new Set<number>()
  for (const ids of groups.values()) {
    if (ids.length > 1) ids.forEach((id) => 중복.add(id))
  }
  return 중복
}

/**
 * 오픈API 원본 필드(지원분야·지원대상·문의처·요약)가 있으면 그게 진짜다 — 우선한다.
 * LLM 추출(ann_summary)은 API가 그 필드를 안 주는 출처(IRIS 등)의 대체 경로일 뿐이다.
 * 지원규모·접수방법은 API 원본에 대응 컬럼이 없어 LLM 추출만 쓴다.
 */
function 요약추출(row: RawAnnouncementRow): AnnouncementSummary | null {
  const llm = row.ann_summary
  const 지원분야 = row.지원분야 ?? llm?.지원분야 ?? null
  const 지원대상 = row.지원대상 ?? llm?.지원대상 ?? null
  const 문의처 = row.문의처 ?? llm?.문의처 ?? null
  const 사업요약 = row.요약 ?? llm?.사업요약 ?? null
  if (!지원분야 && !지원대상 && !문의처 && !사업요약 && !llm) return null
  return {
    지원분야,
    지원대상,
    지원규모: llm?.지원규모 ?? null,
    접수방법: llm?.접수방법 ?? null,
    문의처,
    사업요약,
    ai_확신도: llm?.ai_확신도 ?? null,
  }
}

/** 최신 자격판정의 AI 점수·근거. 사람이 아직 안 봤어도(정정 전) AI 제안은 그대로 보여준다. */
function 점수계산(row: RawAnnouncementRow): {
  자격판정_점수: number | null
  자격판정_근거: string[]
  자격판정_확신도: number | null
  자격판정_확인필요항목: string[]
  자격판정_원판정: string | null
  자격판정_정정여부: boolean | null
  자격판정_확정자: string | null
  자격판정_확정일시: string | null
} {
  if (row.eligibility_decisions.length === 0)
    return {
      자격판정_점수: null,
      자격판정_근거: [],
      자격판정_확신도: null,
      자격판정_확인필요항목: [],
      자격판정_원판정: null,
      자격판정_정정여부: null,
      자격판정_확정자: null,
      자격판정_확정일시: null,
    }
  const 최신 = row.eligibility_decisions.reduce((a, b) =>
    a.created_at > b.created_at ? a : b,
  )
  const 제안 = 최신.ai_제안
  return {
    자격판정_점수: typeof 제안?.점수 === "number" ? 제안.점수 : null,
    자격판정_근거: Array.isArray(제안?.근거) ? 제안.근거 : [],
    자격판정_확신도: typeof 최신.ai_확신도 === "number" ? 최신.ai_확신도 : null,
    자격판정_확인필요항목: Array.isArray(제안?.확인필요항목) ? 제안.확인필요항목 : [],
    자격판정_원판정: 제안?.원판정 ?? null,
    자격판정_정정여부: 최신.정정여부 ?? false,
    자격판정_확정자: 최신.확정자 ?? null,
    자격판정_확정일시: 최신.created_at,
  }
}

/**
 * 사람이 손으로 누른 관심 표시(app.watchlist, 종류='공고'). 실패해도 빈 Set 을
 * 돌려준다 — 관심 표시 하나 때문에 공고 목록 전체가 안 뜨면 안 된다(safeSelect 가
 * 이미 에러를 콘솔에 남긴다).
 */
async function 공고관심목록(): Promise<Map<number, "관심" | "신청예정" | "신청완료">> {
  const { rows } = await safeSelect<{ 참조_id: number; 상태: string }>("watchlist", () =>
    // ⚠ 컬럼을 나열하면 supabase-js 타입 파서가 한글 식별자에서 막힌다(getExpenses 참고).
    db.from("watchlist").select("*").eq("종류", "공고"),
  )
  return new Map(
    rows.map((r) => [
      r.참조_id,
      r.상태 === "신청완료" ? "신청완료" : r.상태 === "신청예정" ? "신청예정" : "관심",
    ]),
  )
}

/**
 * 지원사업 > 공고 탐색. 기업마당 공식 오픈 API 출처만 본다 — 과제사업 쪽과 출처를 섞지 않는다.
 * ⚠ 임베드 select 에 한글 컬럼명을 나열하면 supabase-js 타입 파서가 막힌다(getExpenses 주석 참고) —
 *   그래서 임베드도 `*` 로 받고 타입은 RawAnnouncementRow 로 수동으로 좁힌다.
 */

export const getAnnouncements = async () => {
  const [r, 관심목록] = await Promise.all([
    safeSelect<RawAnnouncementRow>("announcements", () =>
      db
        .from("announcements")
        .select("*, ann_requirements(*), eligibility_decisions(*), ann_summary(*)")
        .eq("출처", "기업마당")
        .order("id")
        .limit(2000),
    ),
    공고관심목록(),
  ])
  const 중복 = 중복후보계산(r.rows)
  return {
    ...r,
    rows: r.rows.map((row) => ({
      ...row,
      자격판정: 판정계산(row),
      ...점수계산(row),
      중복후보: 중복.has(row.id),
      요약: 요약추출(row),
      관심: 관심목록.has(row.id),
      관심상태: 관심목록.get(row.id) ?? null,
    })) as AnnouncementRow[],
  }
}

/**
 * 출처 우선순위 — 낮을수록 위. **IRIS > NTIS.**
 *
 * IRIS 상세페이지에는 공고문(HWP·HWPX·PDF)이 붙어 있어 받아서 접수기간·자격요건·
 * 제출서류까지 판독이 끝난다. NTIS 국가R&D 과제검색 오픈API 는 **이미 수행 중인 과제의
 * 메타정보**라 접수기간도 공고문도 없다(scripts/collect-ntis.mjs 주석) — 신청할 수 없다.
 * 실측 2026-09-03: 요구서류가 뽑힌 공고 7건이 전부 IRIS 다. NTIS 는 16건 중 0건.
 *
 * ⚠ 출처 이름을 알파벳순으로 비교하지 않는다. "IRIS" < "NTIS" 가 우연히 맞아떨어지지만
 *   K-Startup 하나만 붙어도 조용히 틀린다. 출처가 늘면 여기 한 줄을 더한다.
 */
export const 출처_우선순위: Record<string, number> = { IRIS: 0, NTIS: 1 }
export const 출처순위 = (출처: string) => 출처_우선순위[출처] ?? 50

/**
 * 접수 개념이 없는 행(NTIS 과제검색 등). 「공고」로 세지 않고 표 아래로 내린다.
 * 마감유형은 수집기가 채운다 — 출처 이름이 아니라 이 값으로 판단한다.
 */
export const 정보성 = (r: { 마감유형: string }) => r.마감유형 === "정보성"

/**
 * 과제사업 > 공고 탐색. NTIS + IRIS 출처만 본다 — 국가 R&D 과제 공고 도메인이라
 * 지원사업(기업마당, 지자체·중앙부처 지원사업)과 출처 자체가 다르다. 섞지 않는다.
 *
 * 정렬은 **IRIS 먼저, 그 안에서 마감 임박순**이다. 전에는 order("id") 하나뿐이라
 * 수집 순서대로 NTIS 16건이 IRIS 9건 사이에 끼어 위를 차지했다(실측 2026-09-03).
 *
 * DB 에서 접수종료 nulls last 로 한 번 줄여 두는 이유는 limit 때문이다 — 접수기간이 없는
 * NTIS 행이 뒤로 가야 표가 커져도 IRIS 가 잘려 나가지 않는다. 출처 순위는 받아서 확정한다
 * (PostgREST 에 CASE 정렬식을 못 넣는다). sort 는 안정 정렬이라 같은 출처 안에서는
 * DB 가 준 마감 임박순이 그대로 남는다.
 */
export const getRndAnnouncements = async () => {
  const [r, 관심목록] = await Promise.all([
    safeSelect<RawAnnouncementRow>("announcements", () =>
      db
        .from("announcements")
        .select("*, ann_requirements(*), eligibility_decisions(*), ann_summary(*)")
        .in("출처", ["IRIS", "NTIS"])
        .order("접수종료", { ascending: true, nullsFirst: false })
        .order("id")
        .limit(200),
    ),
    공고관심목록(),
  ])
  const 중복 = 중복후보계산(r.rows)
  const rows = r.rows.map((row) => ({
    ...row,
    자격판정: 판정계산(row),
    ...점수계산(row),
    중복후보: 중복.has(row.id),
    요약: 요약추출(row),
    관심: 관심목록.has(row.id),
    관심상태: 관심목록.get(row.id) ?? null,
  })) as AnnouncementRow[]
  return {
    ...r,
    rows: rows.sort((a, b) => 출처순위(a.출처) - 출처순위(b.출처)),
  }
}

export type AnnouncementDetailRow = AnnouncementRow & {
  본문: string | null
}

/**
 * 공고 하나의 전체 필드 — 본문까지 포함하고, 목록(getAnnouncements)과 똑같이
 * 자격판정·점수·근거·확신도·확인필요항목·요약을 계산해서 준다(사용자 요청, 2026-09-03:
 * "사업명 누르면 나오는 내용과 체크리스트가 합쳐진 새 페이지"). 상세 화면 전용.
 * ⚠ 단일 행 조회라 교차 중복후보는 계산하지 않는다(비교 대상이 없다) — 항상 false.
 */
export const getAnnouncementDetail = async (id: number) => {
  const [r, 관심목록] = await Promise.all([
    safeSelect<RawAnnouncementRow & { 본문: string | null }>("announcements", () =>
      db
        .from("announcements")
        .select("*, ann_requirements(*), eligibility_decisions(*), ann_summary(*)")
        .eq("id", id)
        .limit(1),
    ),
    공고관심목록(),
  ])
  return {
    ...r,
    rows: r.rows.map((row) => ({
      ...row,
      자격판정: 판정계산(row),
      ...점수계산(row),
      중복후보: false,
      요약: 요약추출(row),
      관심: 관심목록.has(row.id),
      관심상태: 관심목록.get(row.id) ?? null,
    })) as AnnouncementDetailRow[],
  }
}

export type RequiredDocRow = {
  id: number
  announcement_id: number
  서류명: string
  구분: string | null
  필수여부: boolean
  유효기간_문구: string | null
  원문: string
  근거문장: string | null
  ai_확신도: number | null
  확인상태: string
}

/**
 * 공고 하나가 요구하는 서류 목록 — LLM 판독 결과(claude -p 헤드리스, 근거문장 원문 인용).
 * 구분이 null 인 건 초기 시드 더미 4건(확인 미실행)이고, 값이 있는 건 실제 판독분이다.
 */
export const getRequiredDocs = (announcementId: number) =>
  safeSelect<RequiredDocRow>("ann_required_docs", () =>
    db
      .from("ann_required_docs")
      .select("*")
      .eq("announcement_id", announcementId)
      .order("id"),
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
  관심: boolean
}

export const getAnnouncementBoard = async () => {
  const r = await safeSelect<BoardRow>("v_announcement_board", () =>
    db
      .from("v_announcement_board")
      // 새로 올라온 것이 위로. 그다음 마감이 임박한 순.
      .select("*")
      .order("기준일", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
  )

  // ⚠ 뷰는 공고일이 없으면 수집일을 기준일로 쓴다. NTIS 는 공고일을 안 주므로 수집한 날
  //   전부 「신규」로 찍히고, 기준일 내림차순이라 IRIS 공고 위에 통째로 앉는다.
  //   실측 2026-09-03: 과제 탭 25건 중 NTIS 16건이 「오늘 새로 올라온 공고」로 머리에 섰다.
  //   접수도 못 하는 과제 메타정보를 「어제 없던 공고」라고 말하는 건 거짓이다.
  //   이 보드의 목적이 바로 그 한 줄(케이오시 현안 1번)이라 더 치명적이다.
  //   → 정보성 행은 신규에서 빼고 맨 뒤로 내린다. 버리지는 않는다.
  //
  //   출처순위로 정렬하지 않는 이유: 이 보드에는 기업마당도 섞여 들어온다(구분='과제'인
  //   기업마당 행이 실제로 있다). 출처 순위를 쓰면 접수기간이 멀쩡한 기업마당 공고가
  //   NTIS 밑으로 내려간다. 판단 기준은 출처가 아니라 **접수 개념이 있느냐**다.
  //
  //   뷰(DDL)를 고치지 않는다 — 스키마는 4명 사이의 계약서다. 화면 쪽에서 끝낸다.
  const rows = r.rows
    .map((x) => (정보성(x) ? { ...x, 신규: false } : x))
    .sort((a, b) => Number(정보성(a)) - Number(정보성(b)))
  return { ...r, rows }
}

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

/**
 * 일정 달력 — 대시보드의 달력·이번주 패널이 읽는다.
 * app.v_calendar 가 마감·협약종료·보고예정·서류만료를 한 모양으로 모아 준다.
 *
 * 「행동이 필요한 것만」이 기준이라 뷰에서 이미 걸러져 나온다 —
 * 유효한 서류와 이미 종료된 사업은 안 온다. 봐도 할 일이 없기 때문이다.
 * 색은 여기 없다. 종류만 오고 화면이 색을 고른다.
 */
export type CalendarRow = {
  날짜: string
  종류: string // 관심공고 | 사업종료 | 보고예정 | 서류만료
  제목: string
  부제: string | null
  참조종류: string // 공고 | 사업 | 서류
  참조키: string
  링크: string
  d_day: number | null
}

export const getCalendar = () =>
  safeSelect<CalendarRow>("v_calendar", () =>
    db.from("v_calendar").select("*").order("날짜"),
  )

/**
 * 달력에 못 올리는 것 — 관심 공고 중 마감이 날짜가 아닌 건(상시·소진시·선착순).
 * 실측으로 접수기간의 56%가 이렇다. 안 보여주면 관심 표시한 공고가 조용히 사라진다.
 */
export type UndatedRow = {
  참조키: string
  참조종류: string
  제목: string
  부제: string | null
  사유: string
  링크: string
}

export const getCalendarUndated = () =>
  safeSelect<UndatedRow>("v_calendar_undated", () =>
    db.from("v_calendar_undated").select("*"),
  )

/**
 * 과제 한 건. 상세 화면(개요·연구비 계상·정산)이 전부 이걸로 시작한다.
 * 없으면 rows 가 비어 돌아온다 — 화면이 404 를 띄울지 「없음」을 그릴지는 화면이 정한다.
 */
export const getProject = (id: number) =>
  safeSelect<ProjectRow>("projects", () =>
    db.from("projects").select("*").eq("id", id),
  )

/** 과제 하나의 비목별 배정·집행. 전역 예산 화면과 같은 뷰를 과제로 좁혀 쓴다. */
export const getProjectBudget = (id: number) =>
  safeSelect<BudgetRow>("v_budget_status", () =>
    db.from("v_budget_status").select("*").eq("과제_id", id),
  )

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

/** 과제 하나의 집행 건. 정산 탭의 「사용 건」과 「RCMS 입력 대조」가 같이 쓴다. */
export const getProjectExpenses = (id: number) =>
  safeSelect<ProjectExpenseRow>("expenses", () =>
    db
      .from("expenses")
      // ⚠ 컬럼을 나열하면 supabase-js 타입 파서가 한글 식별자에서 막힌다(getExpenses 참고).
      .select("*")
      .eq("과제_id", id)
      .order("일자", { ascending: false }),
  )

/** 비목 코드 → 이름. 화면에서 코드가 보이면 안 된다. */
export const getCategories = () =>
  safeSelect<{ 코드: string; 이름: string; 정렬: number | null }>("categories", () =>
    db.from("categories").select("*").order("정렬"),
  )

/** 원화 표기. null 은 「—」로 둔다. 0 과 「모름」을 구분한다. */
export const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")

/**
 * 요건별 판정 — bot/mcp_server.py 의 eligibility_check() 계산을 그대로 TypeScript로
 * 옮긴 것이다(2026-09-03, 참가 계획서 문항4① "요건별로 가능·불가·확인 필요를 표로
 * 정리" 요구사항에 맞춰 웹에도 옮겼다 — 그 로직은 지금까지 챗봇 텍스트로만 나왔다).
 *
 * **계산으로 확정되는 자리라 LLM을 쓰지 않는다**(CLAUDE.md 설계원칙 2). 숫자 비교 하나다.
 * 단위를 못 맞추면 비교하지 않고 「확인필요」로 둔다 — 실측에서 74억을 「90억 이상
 * 충족」으로 잘못 판정한 적이 있다(원 단위 저장값과 억원 단위 기준값을 그냥 비교해서).
 * 프롬프트 문구·판단 흐름은 파이썬 원본과 한 글자도 다르지 않게 옮겼다 — 옮기며 동시에
 * 고치면 결과가 달라졌을 때 이식 때문인지 로직을 고쳐서인지 못 가린다.
 */
export type RequirementJudgment = {
  항목: string
  필수여부: boolean
  판정: "충족" | "미충족" | "확인필요"
  상세: string
  근거: string
}

type RawRequirement = {
  항목: string
  필수여부: boolean
  연산자: string | null
  기준값: number | null
  단위: string | null
  원문: string
}

type CompanyProfileValues = Record<string, unknown>

const 요건_항목맵: Record<string, { col: string; 저장단위: string | null }> = {
  매출액: { col: "매출액", 저장단위: "원" },
  매출증가율: { col: "매출증가율", 저장단위: "%" },
  부채비율: { col: "부채비율", 저장단위: "%" },
  자본전액잠식: { col: "자본전액잠식", 저장단위: null },
  "R&D집약도": { col: "rnd_집약도", 저장단위: "%" },
  rnd집약도: { col: "rnd_집약도", 저장단위: "%" },
  기업부설연구소: { col: "기업부설연구소", 저장단위: null },
  종업원수: { col: "종업원수", 저장단위: "명" },
}

// 저장 단위 → 요건 단위로 바꾸는 배수. (저장단위, 요건단위) 조합에 없으면 비교하지 않는다.
const 단위_배수: Record<string, number> = {
  "원|억원": 1 / 100_000_000,
  "원|천만원": 1 / 10_000_000,
  "원|백만원": 1 / 1_000_000,
  "원|만원": 1 / 10_000,
  "원|원": 1,
  "%|%": 1,
  "명|명": 1,
}

const 연산자_비교: Record<string, (a: number, b: number) => boolean> = {
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  eq: (a, b) => a === b,
}

function 숫자표기(n: number): string {
  const s = n.toFixed(1).replace(/\.0$/, "")
  return Number(s).toLocaleString("ko-KR")
}

function 요건판정(r: RawRequirement, p: CompanyProfileValues | null): { 판정: RequirementJudgment["판정"]; 상세: string } {
  const entry = 요건_항목맵[r.항목.replace(/\s+/g, "")]
  if (!entry) return { 판정: "확인필요", 상세: `'${r.항목}' 은 회사 프로필에 대응하는 항목이 없다` }

  const v = p?.[entry.col]
  if (p === null || v === undefined || v === null) {
    return { 판정: "확인필요", 상세: "회사 프로필에 값이 없다" }
  }

  if (typeof v === "boolean") {
    const ok = r.기준값 === null || r.기준값 === 1 ? v : !v
    return { 판정: ok ? "충족" : "미충족", 상세: `우리 ${v ? "보유/해당" : "미보유/해당없음"}` }
  }

  if (r.기준값 === null || r.연산자 === null) {
    return { 판정: "확인필요", 상세: `우리 ${v} (공고에서 기준값·연산자를 못 뽑았다)` }
  }

  const 요건단위 = (r.단위 || entry.저장단위 || "").trim()
  const scale = 단위_배수[`${entry.저장단위 ?? ""}|${요건단위}`]
  if (scale === undefined) {
    return {
      판정: "확인필요",
      상세: `우리 ${Number(v).toLocaleString("ko-KR")} (${entry.저장단위}) / 기준 ${r.기준값} (${요건단위}) — 단위를 맞출 수 없다`,
    }
  }

  const a = Number(v) * scale
  const b = Number(r.기준값)
  const cmp = 연산자_비교[r.연산자]
  if (!cmp) return { 판정: "확인필요", 상세: `알 수 없는 연산자 ${r.연산자}` }
  return { 판정: cmp(a, b) ? "충족" : "미충족", 상세: `우리 ${숫자표기(a)}${요건단위} / 기준 ${숫자표기(b)}${요건단위}` }
}

/**
 * 공고 하나의 요건별 판정 표. `ann_requirements` 가 아직 없으면 빈 배열 —
 * 화면이 "요건 미확인"으로 정직하게 그린다(요건을 추측해서 만들지 않는다).
 */
export const getRequirementJudgments = async (
  announcementId: number,
): Promise<{ rows: RequirementJudgment[]; error: string | null }> => {
  const [{ rows: reqs, error: reqError }, { rows: profiles, error: profError }] = await Promise.all([
    safeSelect<RawRequirement>("ann_requirements", () =>
      db
        .from("ann_requirements")
        // ⚠ 컬럼을 나열하면 supabase-js 타입 파서가 한글 식별자에서 막힌다(getExpenses 참고).
        .select("*")
        .eq("announcement_id", announcementId)
        .order("필수여부", { ascending: false })
        .order("id"),
    ),
    safeSelect<CompanyProfileValues>("company_profile", () =>
      db.from("company_profile").select("*").order("결산연도", { ascending: false }).limit(1),
    ),
  ])
  const company = profiles[0] ?? null
  const rows = reqs.map((r) => {
    const { 판정, 상세 } = 요건판정(r, company)
    return { 항목: r.항목, 필수여부: r.필수여부, 판정, 상세, 근거: r.원문 }
  })
  return { rows, error: reqError ?? profError }
}
