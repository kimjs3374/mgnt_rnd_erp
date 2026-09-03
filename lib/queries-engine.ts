import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 판정 리포트 — **규칙 엔진이 무엇을 어떻게 걸러냈는지**를 숫자로 보여주는 자리.
 *
 * 사용자 요청(2026-09-04): "api로 받아온 raw데이터 대비해서 엔진의 어떤 로직을 기반으로
 * 제외했고 어떻게 이렇게 데이터들이 산출되는지 시각적으로 볼수있고 정량적인 데이터 기반으로
 * 확인할 수 있는 페이지가 필요함".
 *
 * 왜 필요한가 — 이 시스템의 주장은 "LLM 없이 규칙으로 걸러낸다"인데, 걸러진 결과만 보면
 * 그 주장을 검증할 수 없다. **무엇이 몇 건 들어와서, 어느 게이트에서, 몇 건이 왜 빠졌는지**가
 * 보여야 사람이 규칙을 믿거나 고칠 수 있다.
 *
 * ⚠ 집계를 SQL 로 하지 않고 JS 로 한다. 게이트 결과가 jsonb 배열(ann_rule_scores.게이트_결과)
 *   이라 PostgREST 로는 unnest 집계를 못 시킨다. 한 엔진버전이 500~800행이라 통째로 받아
 *   세는 편이 뷰를 새로 만드는 것보다 싸고, DDL 도 안 늘어난다(CLAUDE.md: 추가만 한다).
 */

export type 판정값 = "가능" | "불가" | "확인필요" | "요건미확인" | "해당없음"

type ScoreRow = {
  announcement_id: number
  엔진버전: string
  판정: string
  점수: number | null
  확신도: number | null
  커버리지: number | null
  판정경로: string | null
  게이트_결과: { 키: string; 통과: boolean; 사유?: string; 근거?: string; 보류?: boolean }[] | null
  근거: string[] | null
  llm_호출: number | null
}

type AnnRow = {
  id: number
  사업명: string
  출처: string
  접수종료: string | null
  마감유형: string | null
  지원분야: string | null
  파싱상태: string | null
}

/** 게이트 키 → 사람이 읽는 설명. 무엇을 근거로 걸렀는지가 화면에 그대로 보여야 한다. */
export const 게이트_설명: Record<string, string> = {
  접수마감: "접수가 이미 끝났다 (날짜 비교)",
  지역제한: "공고 지역이 우리 소재지와 다르다 (지역코드 대조)",
  지역제한_시군: "다른 시·군·구 지자체 사업이다 (사업명의 지자체명)",
  지원대상_유형: "공고가 밝힌 지원대상에 우리 기업유형이 없다",
  업종상충: "공고 주제 산업이 우리 업종과 배타적이다",
  창업전용프로그램: "창업 대상 프로그램이다 (우리 업력 초과)",
  창업업력_제한: "창업업력 상한을 우리가 넘는다 (설립일 계산)",
  기관유형_제한: "대학·연구기관 전용이라 기업이 못 낸다",
  개인전용_제한: "개인의 이력(재창업·폐업 등)을 요구한다",
  특정업종전용: "특정 업종 전용 공고다 (사람이 짚은 문구 포함)",
  기업규모_제한: "우리 기업규모를 배제한다",
  부채비율_상한: "부채비율 상한을 우리가 넘는다",
  자본전액잠식_제외: "자본전액잠식 기업을 배제한다",
  체납_제외: "국세·지방세 체납 기업을 배제한다",
  참여제한_제외: "국가연구개발사업 참여제한자를 배제한다",
  매출액_기준: "매출액 기준에 못 미친다",
  종업원수_기준: "종업원수 기준에 못 미친다",
  법인사업자_필수: "법인사업자만 신청할 수 있다",
  기업부설연구소_필수: "기업부설연구소 보유가 필수다",
}

export const 판정_설명: Record<판정값, string> = {
  가능: "게이트를 전부 통과하고 업종 근거까지 있다",
  불가: "게이트 중 하나 이상에서 확정적으로 걸렸다",
  확인필요: "게이트는 통과했으나 모르는 항목이 남았다 — 사람이 본다",
  요건미확인: "공고문을 못 읽어 판정 자체를 못 했다 — 「불가」가 아니다",
  해당없음: "행사·교육 등 애초에 지원사업이 아니다",
}

export type GateStat = {
  키: string
  설명: string
  건수: number
  예시: { id: number; 사업명: string; 사유: string }[]
}

export type EngineReport = {
  엔진버전: string
  llm_호출: number
  수집: { 전체: number; 출처별: { 출처: string; 건수: number }[] }
  퍼널: { 이름: string; 건수: number; 설명: string; 색: string }[]
  판정분포: { 판정: 판정값; 건수: number; 설명: string }[]
  게이트별: GateStat[]
  판정경로: { 경로: string; 건수: number }[]
  버전추이: { 엔진버전: string; 합계: number; 판정: Record<string, number> }[]
  학습: { 판정이력: number; 렉시콘: number; 사람정정: number }
  본문확보: { 상태: string; 건수: number }[]
  error: string | null
}

/** 엔진버전 문자열(r1·r16)을 숫자로 — 문자열 정렬이면 r9 > r16 이 되어버린다. */
function 버전번호(v: string): number {
  const m = /(\d+)/.exec(v || "")
  return m ? Number(m[1]) : -1
}

function 마감지남(a: { 접수종료: string | null; 마감유형: string | null }, 오늘: string): boolean {
  if (!a.접수종료) return false
  if ((a.마감유형 ?? "dated") !== "dated") return false
  return a.접수종료 < 오늘
}

async function 페이지전체<T>(table: string, select: string, 조건 = ""): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < 20; page++) {
    const { rows } = await safeSelect<T>(table, () =>
      db.from(table).select(select).range(page * 1000, page * 1000 + 999) as never,
    )
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return 조건 ? out : out
}

export async function getEngineReport(): Promise<EngineReport> {
  const 오늘 = new Date().toISOString().slice(0, 10)

  const [공고, 점수, 렉시콘, 판정이력, 정정] = await Promise.all([
    페이지전체<AnnRow>("announcements", "id,사업명,출처,접수종료,마감유형,지원분야,파싱상태"),
    페이지전체<ScoreRow>(
      "ann_rule_scores",
      "announcement_id,엔진버전,판정,점수,확신도,커버리지,판정경로,게이트_결과,근거,llm_호출",
    ),
    safeSelect<{ id: number }>("extraction_lexicon", () =>
      db.from("extraction_lexicon").select("id").eq("사용중", true),
    ),
    safeSelect<{ id: number }>("judgment_semantic", () =>
      db.from("judgment_semantic").select("id"),
    ),
    // 한글 컬럼으로 필터만 걸고 select 는 id 만 — 필터는 타입 파서를 안 건드린다.
    safeSelect<{ id: number }>("eligibility_decisions", () =>
      db.from("eligibility_decisions").select("id").eq("정정여부", true),
    ),
  ])

  if (점수.length === 0) {
    return {
      엔진버전: "-", llm_호출: 0,
      수집: { 전체: 공고.length, 출처별: [] },
      퍼널: [], 판정분포: [], 게이트별: [], 판정경로: [], 버전추이: [],
      학습: { 판정이력: 판정이력.rows.length, 렉시콘: 렉시콘.rows.length, 사람정정: 정정.rows.length },
      본문확보: [],
      error: "규칙 엔진 판정 기록이 없다. bot/ann_rules.py 배치를 먼저 돌려야 한다.",
    }
  }

  const 최신버전 = 점수
    .map((s) => s.엔진버전)
    .reduce((a, b) => (버전번호(b) > 버전번호(a) ? b : a))
  const 현재 = 점수.filter((s) => s.엔진버전 === 최신버전)
  const 공고맵 = new Map(공고.map((a) => [a.id, a]))

  // ── 퍼널 — raw 수집에서 최종까지 어디서 얼마나 빠졌나 ────────────────────────
  const 마감건 = 공고.filter((a) => 마감지남(a, 오늘))
  const 판정수 = (v: 판정값) => 현재.filter((s) => s.판정 === v).length

  const 퍼널 = [
    { 이름: "API 수집 원본", 건수: 공고.length,
      설명: "기업마당·K-Startup 오픈API + IRIS·NTIS 로 받아온 전체", 색: "var(--muted-foreground)" },
    { 이름: "접수 마감 제외", 건수: 마감건.length,
      설명: "마감일이 지난 공고 — 판정 대상에서 아예 뺀다(날짜 비교)", 색: "var(--muted-foreground)" },
    { 이름: "지원사업 아님(해당없음)", 건수: 판정수("해당없음"),
      설명: "행사·네트워킹·교육·입주공간 — 자격을 따질 사업이 아니다", 색: "var(--muted-foreground)" },
    { 이름: "자격 불가", 건수: 판정수("불가"),
      설명: "게이트에서 확정적으로 걸렸다(지역·업종·업력·대상 등)", 색: "var(--destructive)" },
    { 이름: "요건 미확인", 건수: 판정수("요건미확인"),
      설명: "공고문을 못 읽어 판정을 못 했다 — 「불가」로 버리지 않는다", 색: "var(--muted-foreground)" },
    { 이름: "확인 필요", 건수: 판정수("확인필요"),
      설명: "게이트는 통과했으나 모르는 항목이 남았다 — 사람이 본다", 색: "var(--warning-fg)" },
    { 이름: "신청 가능", 건수: 판정수("가능"),
      설명: "게이트 전부 통과 + 우리 업종 근거 있음", 색: "var(--success-fg)" },
  ]

  // ── 게이트별 — 무엇이 몇 건을 걸렀나 ──────────────────────────────────────
  const 게이트맵 = new Map<string, GateStat>()
  for (const s of 현재) {
    for (const g of s.게이트_결과 ?? []) {
      if (g.통과 || g.보류) continue
      const cur = 게이트맵.get(g.키) ?? {
        키: g.키, 설명: 게이트_설명[g.키] ?? "규칙 게이트", 건수: 0, 예시: [],
      }
      cur.건수 += 1
      if (cur.예시.length < 3) {
        cur.예시.push({
          id: s.announcement_id,
          사업명: 공고맵.get(s.announcement_id)?.사업명 ?? `공고 ${s.announcement_id}`,
          사유: g.사유 ?? g.근거 ?? "",
        })
      }
      게이트맵.set(g.키, cur)
    }
  }
  const 게이트별 = [...게이트맵.values()].sort((a, b) => b.건수 - a.건수)

  // ── 판정경로 — 규칙만으로 났나, 학습·사람이 얹혔나 ──────────────────────────
  const 경로맵 = new Map<string, number>()
  for (const s of 현재) {
    const k = s.판정경로 || "규칙"
    경로맵.set(k, (경로맵.get(k) ?? 0) + 1)
  }

  // ── 버전 추이 — 규칙을 고칠 때마다 판정이 어떻게 움직였나(전/후 비교) ────────
  const 버전맵 = new Map<string, Record<string, number>>()
  for (const s of 점수) {
    const cur = 버전맵.get(s.엔진버전) ?? {}
    cur[s.판정] = (cur[s.판정] ?? 0) + 1
    버전맵.set(s.엔진버전, cur)
  }
  const 버전추이 = [...버전맵.entries()]
    .sort((a, b) => 버전번호(a[0]) - 버전번호(b[0]))
    .map(([엔진버전, 판정]) => ({
      엔진버전,
      합계: Object.values(판정).reduce((x, y) => x + y, 0),
      판정,
    }))

  // ── 본문 확보율 — 「요건미확인」이 왜 남는지의 근거 ─────────────────────────
  const 본문맵 = new Map<string, number>()
  for (const a of 공고) {
    const k = a.파싱상태 || "미상"
    본문맵.set(k, (본문맵.get(k) ?? 0) + 1)
  }

  const 출처맵 = new Map<string, number>()
  for (const a of 공고) 출처맵.set(a.출처, (출처맵.get(a.출처) ?? 0) + 1)

  return {
    엔진버전: 최신버전,
    llm_호출: 현재.reduce((n, s) => n + (s.llm_호출 ?? 0), 0),
    수집: {
      전체: 공고.length,
      출처별: [...출처맵.entries()].map(([출처, 건수]) => ({ 출처, 건수 }))
        .sort((a, b) => b.건수 - a.건수),
    },
    퍼널,
    판정분포: (["가능", "확인필요", "요건미확인", "불가", "해당없음"] as 판정값[]).map((v) => ({
      판정: v, 건수: 판정수(v), 설명: 판정_설명[v],
    })),
    게이트별,
    판정경로: [...경로맵.entries()].map(([경로, 건수]) => ({ 경로, 건수 }))
      .sort((a, b) => b.건수 - a.건수),
    버전추이,
    학습: {
      판정이력: 판정이력.rows.length,
      렉시콘: 렉시콘.rows.length,
      사람정정: 정정.rows.length,
    },
    본문확보: [...본문맵.entries()].map(([상태, 건수]) => ({ 상태, 건수 }))
      .sort((a, b) => b.건수 - a.건수),
    error: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 역방향 — 엔진이 「불가」·「해당없음」으로 접은 것을 사람이 다시 연다
//
// 사용자 요청(2026-09-04): "불가 판정이나 해당없음 판정 받았던 건들 중에 사람이 직접
// 확인해서 반대로 가능으로 상태변경이나 신청해서 관리할 수 있도록 하는 역방향도 구현해".
//
// 이게 있어야 규칙을 믿고 쓸 수 있다 — 규칙이 틀렸을 때 사람이 되돌릴 길이 없으면,
// 「불가」로 잘못 찍힌 공고는 조용히 사라진다(설계원칙 5).
// ─────────────────────────────────────────────────────────────────────────────
export type ReversibleRow = {
  id: number
  사업명: string
  출처: string
  접수종료: string | null
  마감유형: string | null
  판정: 판정값
  판정경로: string | null
  확신도: number | null
  근거: string[]
  걸린게이트: { 키: string; 설명: string; 사유: string }[]
  관심상태: string | null
  사람이정정함: boolean
}

/**
 * 되돌릴 수 있는 후보 — 「불가」·「해당없음」이면서 **아직 마감 전**인 공고.
 * 마감이 지난 건 되돌려도 신청할 수 없어 목록만 어지럽힌다.
 */
/** 화면에 한 번에 그리는 상한. 확신도가 낮은 것부터 자르므로 **볼 값어치가 큰 쪽이 남는다.** */
const 되돌리기_상한 = 150

export async function getReversible(): Promise<{
  rows: ReversibleRow[]
  전체: number
  error: string | null
}> {
  const 오늘 = new Date().toISOString().slice(0, 10)

  const [공고, 점수, 관심, 결정] = await Promise.all([
    페이지전체<AnnRow>("announcements", "id,사업명,출처,접수종료,마감유형,지원분야,파싱상태"),
    페이지전체<ScoreRow>(
      "ann_rule_scores",
      "announcement_id,엔진버전,판정,점수,확신도,커버리지,판정경로,게이트_결과,근거,llm_호출",
    ),
    // ⚠ select() 에 한글 컬럼명을 나열하면 supabase-js 타입 파서가 막힌다(lib/queries.ts
    //   에 같은 주석이 있다 — 런타임이 아니라 컴파일 문제다). * 로 받고 타입으로 좁힌다.
    safeSelect<{ 참조_id: number; 상태: string }>("watchlist", () =>
      db.from("watchlist").select("*").eq("종류", "공고"),
    ),
    safeSelect<{ announcement_id: number; 정정여부: boolean; created_at: string }>(
      "eligibility_decisions",
      () => db.from("eligibility_decisions").select("*").eq("정정여부", true),
    ),
  ])

  if (점수.length === 0) return { rows: [], 전체: 0, error: "규칙 엔진 판정 기록이 없다." }

  const 최신버전 = 점수.map((s) => s.엔진버전)
    .reduce((a, b) => (버전번호(b) > 버전번호(a) ? b : a))
  const 공고맵 = new Map(공고.map((a) => [a.id, a]))
  const 관심맵 = new Map(관심.rows.map((w) => [w.참조_id, w.상태]))
  const 정정집합 = new Set(결정.rows.map((d) => d.announcement_id))

  const rows: ReversibleRow[] = []
  for (const s of 점수) {
    if (s.엔진버전 !== 최신버전) continue
    if (s.판정 !== "불가" && s.판정 !== "해당없음") continue
    const a = 공고맵.get(s.announcement_id)
    if (!a || 마감지남(a, 오늘)) continue

    rows.push({
      id: a.id,
      사업명: a.사업명,
      출처: a.출처,
      접수종료: a.접수종료,
      마감유형: a.마감유형,
      판정: s.판정 as 판정값,
      판정경로: s.판정경로,
      확신도: s.확신도,
      근거: (s.근거 ?? []).slice(0, 4),
      걸린게이트: (s.게이트_결과 ?? [])
        .filter((g) => !g.통과 && !g.보류)
        .map((g) => ({ 키: g.키, 설명: 게이트_설명[g.키] ?? "규칙 게이트", 사유: g.사유 ?? "" })),
      관심상태: 관심맵.get(a.id) ?? null,
      사람이정정함: 정정집합.has(a.id),
    })
  }

  // 확신도가 낮은 것부터 — 기계가 덜 확신한 것일수록 사람이 볼 값어치가 크다.
  rows.sort((x, y) => (x.확신도 ?? 1) - (y.확신도 ?? 1))
  return { rows: rows.slice(0, 되돌리기_상한), 전체: rows.length, error: null }
}
