import "server-only"
import { db, safeSelect } from "@/lib/db"
import type { AnnouncementRow, AnnouncementSummary } from "@/lib/queries"

/**
 * 공고 탐색 — **지원사업과 과제사업이 같은 로직을 탄다.**
 *
 * 화면은 components/announcements-explorer.tsx 하나(과제사업이 기준)이고, 여기가 그 화면에
 * 넣을 행을 만든다. 두 화면의 차이는 **받아오는 raw 데이터뿐**이다:
 *
 *   과제사업 — IRIS·NTIS. 공고문(HWP·PDF)을 받아 LLM 이 요건을 뽑아 둔 것이 있다.
 *   지원사업 — 기업마당·K-Startup. 오픈API 가 지역·지원대상을 정제해서 준다.
 *
 * 판정 함수는 하나다. 우선순위 사슬을 따라 내려가면서 **그 행에 있는 근거**를 쓴다.
 * 그래서 데이터가 달라도 코드가 갈라지지 않는다.
 *
 * ⚠ lib/queries.ts 를 건드리지 않는다. 네 명이 같이 쓰는 파일이고, 같은 디렉터리에서
 *   두 명이 동시에 열면 나중에 저장한 쪽이 통째로 덮어쓴다(git log "queries.ts 저장 충돌 복구").
 *   타입만 가져다 쓴다.
 */

/** 지원사업 도메인의 출처. 과제사업(IRIS·NTIS)과 섞지 않는다 — 도메인이 다르다. */
export const 지원사업_출처 = ["기업마당", "K-Startup"]

export type CompanyFilter = {
  회사명: string | null
  소재지: string | null
  지역코드: string[]
  기업규모: string | null
  지원대상_유형: string[]
  업종명: string[]
}

/** 대조 기준이 되는 우리 쪽 값. 비면 아무것도 못 거른다 — 화면이 그 사실을 그대로 말한다. */
export const getCompanyFilter = async (): Promise<{
  company: CompanyFilter | null
  error: string | null
}> => {
  const r = await safeSelect<Record<string, unknown>>("company_profile", () =>
    db.from("company_profile").select("*").order("결산연도", { ascending: false }).limit(1),
  )
  const c = r.rows[0]
  if (!c) return { company: null, error: r.error }
  return {
    company: {
      회사명: (c.회사명 as string) ?? null,
      소재지: (c.소재지 as string) ?? null,
      지역코드: (c.지역코드 as string[]) ?? [],
      기업규모: (c.기업규모 as string) ?? null,
      지원대상_유형: (c.지원대상_유형 as string[]) ?? [],
      업종명: (c.업종명 as string[]) ?? [],
    },
    error: r.error,
  }
}

/**
 * 회사 유형 → 공고가 쓰는 표기들.
 * 같은 뜻인데 출처마다 말이 다르다 — 기업마당 trgetNm 은 「중소기업」, K-Startup aply_trgt 는
 * 「일반기업」이라고 적는다. 표가 없으면 K-Startup 공고가 통째로 「불가」가 되어 사라진다.
 */
const 대상_별칭: Record<string, string[]> = {
  중소기업: ["중소기업", "중견기업", "일반기업", "중소·중견기업"],
  소상공인: ["소상공인"],
  창업벤처: ["창업벤처", "예비창업자", "1인 창조기업"],
  사회적기업: ["사회적기업"],
  여성기업: ["여성기업"],
  장애인기업: ["장애인기업"],
  마을기업: ["마을기업"],
}

/** 지역을 모르는 공고(null)는 걸러내지 않는다 — 「불가」로 잘못 판정하면 조용히 버려진다. */
function 지역해당(공고지역: string[] | null, 회사지역: string[]): boolean | null {
  if (!공고지역 || 공고지역.length === 0 || 회사지역.length === 0) return null
  if (공고지역.includes("전국")) return true
  return 공고지역.some((r) => 회사지역.includes(r))
}

function 대상해당(공고대상: string | null, 회사유형: string[]): boolean | null {
  if (!공고대상 || 회사유형.length === 0) return null
  const 표기 = 회사유형.flatMap((t) => 대상_별칭[t] ?? [t])
  return 표기.some((t) => 공고대상.includes(t))
}

type RawRow = Record<string, unknown> & {
  ann_requirements?: { id: number }[]
  eligibility_decisions?: { 확정_판정: string; created_at: string }[]
  ann_summary?: AnnouncementSummary[]
}

/**
 * 자격판정 — **두 화면이 쓰는 단 하나의 함수.** 우선순위 사슬을 따라 내려간다.
 *
 *   ① 사람이 확정한 판정(eligibility_decisions)  — 가장 세다. 정정 이력이 규정을 이긴다.
 *   ② 공고문에서 뽑은 요건(ann_requirements)     — 읽긴 읽었는데 확정이 없다 → 확인필요
 *   ③ 오픈API 가 준 지역·지원대상 × 회사 프로필   — 계산으로 확정되는 자리다
 *   ④ 아무 근거도 없다                            → 요건미확인
 *
 * 이 순서가 CLAUDE.md 의 판단 우선순위(정정 이력 > 과거 집행 > 규정 > 일반 상식)와 같은 모양이다.
 * ③이 과제사업(IRIS)에서 조용히 건너뛰어지는 이유는 로직이 달라서가 아니라
 * **그 행에 지역코드·지원대상이 없기 때문**이다 — raw 데이터만 다르다.
 *
 * 「불가」는 확실할 때만 쓴다. 모르면 「확인필요」로 두고 사람이 보게 한다 —
 * 「불가」로 잘못 판정하면 신청할 수 있는 공고를 조용히 버린다(설계원칙 5).
 */
function 판정계산(row: RawRow, company: CompanyFilter | null): AnnouncementRow["자격판정"] {
  // ① 확정 판정이 있으면 그것이 답이다.
  const 결정 = row.eligibility_decisions ?? []
  if (결정.length > 0) {
    const 최신 = 결정.reduce((a, b) => (a.created_at > b.created_at ? a : b))
    if (최신.확정_판정 === "가능" || 최신.확정_판정 === "불가") return 최신.확정_판정
    return "확인필요"
  }

  // ② 공고문 요건을 읽어 뒀는데 확정이 없다.
  if ((row.ann_requirements ?? []).length > 0) return "확인필요"

  // ③ 계산으로 확정되는 자리 — 지역·지원대상. LLM 을 쓰지 않는다(설계원칙 1).
  if (company) {
    const 지역 = 지역해당((row.지역코드 as string[]) ?? null, company.지역코드)
    const 대상 = 대상해당((row.지원대상 as string) ?? null, company.지원대상_유형)
    if (지역 === false || 대상 === false) return "불가"
    if (지역 === true && 대상 === true) return "가능"
    if (지역 != null || 대상 != null) return "확인필요"
  }

  // ④ 근거가 없다. 안 읽은 것이지 안 되는 것이 아니다.
  return "요건미확인"
}

/**
 * 상세 Sheet 가 읽는 요약.
 *
 * 과제사업은 이 자리를 app.ann_summary(공고문 본문에서 LLM 이 뽑은 것)로 채운다.
 * 지원사업은 **오픈API 가 이미 정제해서 주는 값**이 있어 LLM 을 부를 이유가 없다.
 * 그래서 순서는 「LLM 요약이 있으면 그것, 없으면 API 필드」다 — 여기서도 코드는 하나고
 * 어느 쪽이 채워져 있느냐만 다르다. 없는 값(지원규모·접수방법)은 null 로 둔다.
 */
function 요약추출(row: RawRow): AnnouncementSummary | null {
  const llm = row.ann_summary?.[0]
  if (llm) return llm

  const 지원분야 = (row.지원분야 as string) ?? null
  const 지원대상 = (row.지원대상 as string) ?? null
  const 문의처 = (row.문의처 as string) ?? null
  const 사업요약 = (row.요약 as string) ?? null
  if (!지원분야 && !지원대상 && !문의처 && !사업요약) return null
  return {
    지원분야,
    지원대상,
    지원규모: null, // 오픈API 가 안 준다. 공고문을 읽어야 나온다.
    접수방법: null, // 〃
    문의처,
    사업요약,
    // 기관이 API 로 준 값이다. LLM 추출이 아니라 「확신도」라는 개념이 없다.
    ai_확신도: null,
  }
}

/** 사업명 정규화 — 재공고·연장공고 후보. 완전일치만 본다(오탐이 잘못된 병합보다 낫다). */
function 정규화(사업명: string): string {
  return 사업명
    .replace(/^\s*\[[^\]]*\]/, "") // [전남광주] 같은 지역 태그는 빼고 본다
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(공고|재공고|수정공고|모집|안내)+$/g, "")
}

function 중복후보계산(rows: { id: number; 사업명: string; 소관부처: string | null }[]) {
  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const key = 정규화(r.사업명)
    if (!key) continue
    const k = `${r.소관부처 ?? ""}::${key}`
    groups.set(k, [...(groups.get(k) ?? []), r.id])
  }
  const 중복 = new Set<number>()
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id) => 중복.add(id))
  return 중복
}

/** 화면이 받는 행 — AnnouncementRow 그대로에 원본 배열·원문 링크만 얹는다. */
export type ProgramRow = AnnouncementRow & {
  지역코드: string[] | null
  공고url: string | null
}

/**
 * 공고 목록 — 출처만 갈아끼우면 어느 화면이든 같은 모양으로 나온다.
 *
 * 정렬은 마감 임박순. 접수종료가 없는 건(상시·소진시 — 실측 56%)은 뒤로 보낸다.
 * 「곧 닫히는 것부터」가 이 화면이 답해야 할 순서다. 수집 순서(id)는 사용자에게 뜻이 없다.
 */
export const getAnnouncementsBySource = async (출처: string[]) => {
  const [{ company, error: companyError }, r] = await Promise.all([
    getCompanyFilter(),
    safeSelect<RawRow>("announcements", () =>
      db
        .from("announcements")
        // ⚠ 임베드에 한글 컬럼명을 나열하면 supabase-js 타입 파서가 막힌다(lib/queries.ts 참고).
        //   런타임이 아니라 컴파일 문제라 * 로 받고 타입으로 좁힌다.
        .select("*, ann_requirements(*), eligibility_decisions(*), ann_summary(*)")
        .in("출처", 출처)
        .order("접수종료", { ascending: true, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(2000),
    ),
  ])

  const 중복 = 중복후보계산(
    r.rows.map((x) => ({
      id: x.id as number,
      사업명: x.사업명 as string,
      소관부처: (x.소관부처 as string) ?? null,
    })),
  )

  const rows: ProgramRow[] = r.rows.map((x) => {
    const 지역코드 = (x.지역코드 as string[]) ?? null
    return {
      id: x.id as number,
      출처: x.출처 as string,
      출처_id: (x.출처_id as string) ?? null,
      사업명: x.사업명 as string,
      소관부처: (x.소관부처 as string) ?? null,
      전문기관: (x.전문기관 as string) ?? null,
      // 화면의 지역 필터는 이 문자열로 거른다. 배열 원본은 지역코드로 따로 넘긴다.
      // 여러 지역이 걸린 공고(대구ㆍ경북 등)는 붙여 한 항목으로 둔다 — 실측 802건 중 2건이다.
      지역: 지역코드?.length ? 지역코드.join("·") : ((x.지역 as string) ?? null),
      지역코드,
      접수시작: (x.접수시작 as string) ?? null,
      접수종료: (x.접수종료 as string) ?? null,
      마감유형: (x.마감유형 as string) ?? "미상",
      공고문_파일명: (x.공고문_파일명 as string) ?? null,
      공고문_url: (x.공고문_url as string) ?? null,
      공고url: (x.공고url as string) ?? null,
      파싱상태: (x.파싱상태 as string) ?? "목록만",
      자격판정: 판정계산(x, company),
      중복후보: 중복.has(x.id as number),
      요약: 요약추출(x),
    }
  })

  return { rows, error: r.error ?? companyError, company }
}

/** 지원사업 > 공고 탐색. 출처만 다르고 나머지는 과제사업과 같은 경로를 탄다. */
export const getProgramAnnouncements = () => getAnnouncementsBySource(지원사업_출처)
