import "server-only"
import { db, safeSelect } from "@/lib/db"
import { getFundingShareRules, getCompanyProfile, getAllBudgets } from "@/lib/queries-project"
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
export type 계상단계 = "사업비_미확정" | "미계상" | "진행중" | "완료" | "초과"

export const 단계이름: Record<계상단계, string> = {
  사업비_미확정: "사업비 미확정",
  미계상: "계상 전",
  진행중: "계상 중",
  완료: "계상 완료",
  초과: "총사업비 초과",
}

const 단계순서: 계상단계[] = ["사업비_미확정", "미계상", "초과", "진행중", "완료"]

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
 * 계상 대상 = **선정된 과제**.
 *
 * ⚠ 거르는 기준을 `/projects` 대장과 **같게** 맞춘다 — 신청중(상태) · 미선정(선정결과) 만 뺀다.
 *   시드 12건은 케이오시 관리대장(엑셀)에서 온 것이라 `선정결과` 칸이 비어 있다.
 *   `선정결과 = '선정'` 으로 거르면 대장이 통째로 비어 버린다(대장 화면이 이미 겪은 함정).
 */
export async function getBudgetingRows() {
  const [과제, 예산, 규칙, 회사, 공고] = await Promise.all([
    safeSelect<ProjectRowRaw>("projects", () => db.from("projects").select("*")),
    getAllBudgets(),
    getFundingShareRules(),
    getCompanyProfile(),
    safeSelect<{ id: number; 사업명: string }>("announcements", () =>
      db.from("announcements").select("*"),
    ),
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
    .filter((p) => p.상태 !== "신청중" && p.선정결과 !== "미선정")
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
        단계: 단계판정(총사업비, agg.합),
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
