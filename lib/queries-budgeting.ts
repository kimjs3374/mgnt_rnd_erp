import "server-only"
import { db, safeSelect } from "@/lib/db"
import { getFundingShareRules, getCompanyProfile, getAllBudgets } from "@/lib/queries-project"
import { getConfirmedProjectIds } from "@/lib/queries-confirm"
import { pickRule, computeShare } from "@/lib/funding-share"
import type { Share } from "@/lib/funding-share"

/**
 * 「과제 계상」 화면 전용 조회 — **선정된 과제를 계상까지 밀어 넣는 대기열**.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다. 네 명이 동시에 여는 파일이라 저장 충돌이 두 번 났다
 *   (`_팀로그/memory/queries-ts-concurrent-save.md`).
 */

export type BudgetingRow = {
  id: number
  과제명: string
  과제코드: string | null
  상태: string
  선정결과: string | null
  선정결과일: string | null
  공고_id: number | null
  공고명: string | null
  사업유형: string | null
  총사업비: number
  정부지원금: number | null
  기관부담_현금: number | null
  기관부담_현물: number | null
  /** 이 과제에 잡힌 비목 배정의 합. 0 이면 아직 한 줄도 안 잡았다는 뜻. */
  배정합: number
  계상건수: number
  /** 총사업비 − 배정합. 양수면 아직 덜 잡았다. */
  남은액: number
  단계: 계상단계
  /**
   * **아직 선정 전(신청중)인가.** 계상의 뜻이 갈린다 —
   * 신청 단계 계상은 **신청서에 넣는 사업비 계획**이고, 선정 뒤 계상은 **협약 금액을 쪼개는 일**이다.
   * 금액의 출처도 다르다(내가 써낸 금액 vs 기관이 확정해 준 금액).
   * 화면이 둘을 같은 말로 부르면 「협약금액 확정」 버튼을 신청 전에 누르게 된다.
   */
  신청단계: boolean
  /** 공고·사업유형·기관유형으로 고른 규칙으로 계산한 재원 구성. 규칙이 없으면 null. */
  제안: Share | null
}

/**
 * 계상이 어디까지 왔는지. **순서가 곧 화면 정렬 순서**이고, 앞쪽이 손이 필요한 것이다.
 *
 * ⚠ 「사업비 미확정」을 「미계상」과 합치지 않는다. 둘은 할 일이 다르다 —
 *   앞은 **협약 금액을 정하는 일**(총사업비가 0이라 비목을 나눌 기준 자체가 없다),
 *   뒤는 **그 금액을 비목으로 쪼개는 일**이다. 합치면 화면이 「계상하세요」라고만 말하고
 *   정작 계상 화면에 가면 기준이 0이라 아무것도 못 한다.
 */
export type 계상단계 = "사업비_미확정" | "미계상" | "진행중" | "완료" | "초과" | "확정"

export const 단계이름: Record<계상단계, string> = {
  사업비_미확정: "사업비 미확정",
  미계상: "계상 전",
  진행중: "계상 중",
  완료: "계상 완료",
  초과: "총사업비 초과",
  확정: "확정 · 대장 관리",
}

/**
 * 「확정」이 맨 끝이다 — 사람이 계상 확정을 누른 건이고, 그 뒤로는 **관리 위치가 사업 대장**이라
 * 이 화면에서 할 일이 없다(`db/100`). 「손이 필요한 것만」 필터에서 자연히 빠진다.
 * 「완료」와 갈라 둔 이유: 합계가 맞는 것(완료)과 사람이 잠근 것(확정)은 다른 사실이다.
 */
const 단계순서: 계상단계[] = ["사업비_미확정", "미계상", "초과", "진행중", "완료", "확정"]

function 단계판정(총사업비: number, 배정합: number): 계상단계 {
  if (!총사업비 || 총사업비 <= 0) return "사업비_미확정"
  if (배정합 <= 0) return "미계상"
  if (배정합 > 총사업비) return "초과"
  if (배정합 === 총사업비) return "완료"
  return "진행중"
}

type ProjectRowRaw = {
  id: number
  과제명: string
  과제코드: string | null
  상태: string
  선정결과: string | null
  선정결과일: string | null
  공고_id: number | null
  사업유형: string | null
  총사업비: number | null
  정부지원금: number | null
  기관부담_현금: number | null
  기관부담_현물: number | null
}

/**
 * 계상 대상 = **미선정을 뺀 모든 과제**. 신청중도 들어온다(2026-09-04 사용자 지시).
 *
 * ⚠ 전에는 신청중을 뺐다. 그런데 **사업비 계상은 신청서에 넣는 것**이라 선정 전에 해야 한다 —
 *   선정된 뒤에 처음 계상하는 순서는 실제 일과 반대다. 그래서 신청중을 넣되
 *   `신청단계` 로 표시해 화면이 「협약」과 「신청」을 다른 말로 부르게 한다.
 *
 * ⚠ `선정결과 = '선정'` 으로 거르지 않는다. 시드 12건은 케이오시 관리대장(엑셀)에서 온 것이라
 *   `선정결과` 칸이 비어 있어서, 그걸로 거르면 목록이 통째로 빈다(대장 화면이 이미 겪은 함정).
 *   **「아직 선정 안 됐다고 확인된 것」(미선정)만** 뺀다.
 */
export async function getBudgetingRows() {
  const [과제, 예산, 규칙, 회사, 공고, 확정] = await Promise.all([
    safeSelect<ProjectRowRaw>("projects", () => db.from("projects").select("*")),
    getAllBudgets(),
    getFundingShareRules(),
    getCompanyProfile(),
    safeSelect<{ id: number; 사업명: string }>("announcements", () =>
      db.from("announcements").select("*"),
    ),
    getConfirmedProjectIds(),
  ])

  const error = 과제.error ?? 예산.error ?? null
  const 기관유형 = (회사.rows[0]?.기업규모 as string | undefined) ?? null
  const 공고명 = new Map(공고.rows.map((a) => [a.id, a.사업명]))

  const 배정 = new Map<number, { 합: number; 건수: number }>()
  for (const b of 예산.rows) {
    const cur = 배정.get(b.과제_id) ?? { 합: 0, 건수: 0 }
    cur.합 += Number(b.배정액 ?? 0)
    cur.건수 += 1
    배정.set(b.과제_id, cur)
  }

  const rows: BudgetingRow[] = 과제.rows
    .filter((p) => p.선정결과 !== "미선정")
    .map((p) => {
      const 총사업비 = Number(p.총사업비 ?? 0)
      const agg = 배정.get(p.id) ?? { 합: 0, 건수: 0 }
      const rule = pickRule(규칙.rows, {
        공고_id: p.공고_id,
        사업유형: p.사업유형,
        기관유형,
      })
      return {
        id: p.id,
        과제명: p.과제명,
        과제코드: p.과제코드,
        상태: p.상태,
        선정결과: p.선정결과,
        선정결과일: p.선정결과일,
        공고_id: p.공고_id,
        공고명: p.공고_id == null ? null : (공고명.get(p.공고_id) ?? null),
        사업유형: p.사업유형,
        총사업비,
        정부지원금: p.정부지원금 == null ? null : Number(p.정부지원금),
        기관부담_현금: p.기관부담_현금 == null ? null : Number(p.기관부담_현금),
        기관부담_현물: p.기관부담_현물 == null ? null : Number(p.기관부담_현물),
        배정합: agg.합,
        계상건수: agg.건수,
        남은액: 총사업비 - agg.합,
        // 사람이 확정을 눌렀으면 그것이 마지막 사실이다 — 합계 판정보다 앞선다.
        단계: 확정.ids.has(p.id) ? ("확정" as 계상단계) : 단계판정(총사업비, agg.합),
        // 선정 전이면 이 계상은 「협약」이 아니라 **신청서에 넣는 계획**이다.
        신청단계: p.상태 === "신청중" || p.선정결과 === "접수" || p.선정결과 === "발표심사",
        // 총사업비가 0이면 계산이 안 된다(computeShare 가 null). 그때는 금액을 넣는 순간
        // 화면이 미리보기를 만든다 — 여기서는 규칙이 잡히는지까지만 확인해 둔다.
        제안: computeShare(총사업비 > 0 ? 총사업비 : null, rule),
      }
    })

  // 손이 필요한 것이 위로. 같은 단계면 최근 선정된 것이 위로 온다.
  rows.sort((a, b) => {
    const d = 단계순서.indexOf(a.단계) - 단계순서.indexOf(b.단계)
    if (d !== 0) return d
    return (b.선정결과일 ?? "").localeCompare(a.선정결과일 ?? "") || b.id - a.id
  })

  return { rows, error, 기관유형, 규칙수: 규칙.rows.length }
}

/* ------------------------------------------------------------------------- *
 * 관심 공고 — 계상보다 **앞 단계**다. 그래서 화면에서도 위에 둔다.
 * ------------------------------------------------------------------------- */

export type WatchRow = {
  공고_id: number
  사업명: string
  소관부처: string | null
  접수종료: string | null
  사업유형: string | null
  출처: string
  메모: string | null
  /** 공고 상세 경로. IRIS·NTIS 는 과제사업 쪽, 기업마당·K-Startup 은 지원사업 쪽 화면이 맡는다. */
  상세경로: string
  /** 접수 마감까지 남은 날. 음수면 지났다. 마감일이 없으면 null. */
  남은일: number | null
  /** 이 공고로 이미 지원 등록한 과제 중 **가장 앞선 것**. 없으면 아직 안 넣은 것이다. */
  지원과제: { id: number; 과제명: string; 상태: string; 선정결과: string | null; 단계: 계상단계 | null } | null
  /** 같은 공고로 등록된 과제 수. 2 이상이면 화면이 「외 N건」을 붙인다. */
  지원건수: number
}

/** KST 오늘(YYYY-MM-DD). 서버·클라이언트가 같은 값을 내야 해서 직접 계산한다. */
function 오늘KST() {
  const k = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`
}

function 남은날(마감: string | null): number | null {
  if (!마감) return null
  const a = Date.parse(`${마감}T00:00:00Z`)
  const b = Date.parse(`${오늘KST()}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}

/**
 * 관심 표시한 공고 + **그 공고로 지원했는지**까지.
 *
 * 계상 화면 맨 위에 두는 이유: 계상은 흐름의 **끝**이고 관심 공고는 **처음**이다.
 * 「지금 챙겨야 할 것」을 한 화면에서 보려면 앞 단계가 위에 있어야 한다 —
 * 마감이 지나가는 공고는 계상할 과제보다 급하다.
 *
 * ⚠ 과제사업(IRIS) 공고만 거르지 않는다. 관심은 **사람이 직접 표시한 것**이라
 *   여기서 걸러 버리면 표시해 둔 것이 사라진 것처럼 보인다. 대신 사업유형·출처를 같이 보여
 *   어느 쪽 공고인지 알 수 있게 한다(CLAUDE.md §0.5 — 지원사업이 중심, R&D 는 그중 한 유형).
 */
export async function getWatchlistAnnouncements() {
  const [관심, 공고, 과제, 예산] = await Promise.all([
    safeSelect<{ 종류: string; 참조_id: number; 메모: string | null; created_at: string }>(
      "watchlist",
      () => db.from("watchlist").select("*"),
    ),
    safeSelect<{
      id: number
      사업명: string
      소관부처: string | null
      접수종료: string | null
      사업유형: string | null
      출처: string
    }>("announcements", () => db.from("announcements").select("*")),
    safeSelect<ProjectRowRaw>("projects", () => db.from("projects").select("*")),
    getAllBudgets(),
  ])

  const 공고맵 = new Map(공고.rows.map((a) => [a.id, a]))
  const 배정 = new Map<number, number>()
  for (const b of 예산.rows) 배정.set(b.과제_id, (배정.get(b.과제_id) ?? 0) + Number(b.배정액 ?? 0))

  const rows: WatchRow[] = 관심.rows
    .filter((w) => w.종류 === "공고")
    .map((w) => {
      const a = 공고맵.get(w.참조_id)
      if (!a) return null

      // ⚠ 한 공고에 과제가 여러 개일 수 있다(연차·컨소시엄·재신청). `find` 로 아무거나 집으면
      //   화면이 매번 다른 걸 보여준다. **가장 앞선 것**을 고른다 — 선정 > 심사중 > 미선정,
      //   같으면 최근 것(id 큰 것). 여러 건이면 그 사실도 같이 말한다.
      const 후보 = 과제.rows.filter((x) => x.공고_id === a.id)
      const 점수 = (x: ProjectRowRaw) =>
        x.선정결과 === "미선정" ? 0 : x.상태 === "신청중" ? 1 : 2
      후보.sort((x, y) => 점수(y) - 점수(x) || y.id - x.id)
      const p = 후보[0] ?? null
      const 과제사업 = a.출처 === "IRIS" || a.출처 === "NTIS"
      return {
        공고_id: a.id,
        사업명: a.사업명,
        소관부처: a.소관부처,
        접수종료: a.접수종료,
        사업유형: a.사업유형,
        출처: a.출처,
        메모: w.메모,
        상세경로: 과제사업 ? `/project-announcements/${a.id}` : `/announcements/${a.id}`,
        남은일: 남은날(a.접수종료),
        지원건수: 후보.length,
        지원과제: p
          ? {
              id: p.id,
              과제명: p.과제명,
              상태: p.상태,
              선정결과: p.선정결과,
              // 아직 선정 전이면 계상 단계를 말하지 않는다 — 없는 단계를 있는 척하지 않는다.
              단계:
                p.상태 === "신청중" || p.선정결과 === "미선정"
                  ? null
                  : 단계판정(Number(p.총사업비 ?? 0), 배정.get(p.id) ?? 0),
            }
          : null,
      }
    })
    .filter((r): r is WatchRow => r != null)

  // 마감이 가까운 것이 위로. 마감이 지났거나 없는 것은 아래로 민다.
  rows.sort((a, b) => {
    const 점 = (r: WatchRow) => (r.남은일 == null ? 1e9 : r.남은일 < 0 ? 1e8 - r.남은일 : r.남은일)
    return 점(a) - 점(b)
  })

  return { rows, error: 관심.error ?? 공고.error ?? null }
}
