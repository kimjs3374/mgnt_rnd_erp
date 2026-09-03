/**
 * 개인별 인건비 계상 계산 — 순수 함수. 서버·브라우저가 같은 코드를 쓴다.
 *
 * 실제 양식(연구개발계획서 인건비 계상표)의 식을 그대로 옮겼다. 실측으로 맞춰 본 값 —
 *   4,000,000 × 25%  × 6 =  6,000,000
 *   3,000,000 × 27.5% × 6 =  4,950,000
 *   8,000,000 × 70%  × 6 = 33,600,000
 * 급여총액은 월급여 × 12 다(4,000,000 → 48,000,000).
 *
 * ⚠ 절사하지 않는다. 양식이 원 단위로 딱 맞게 나오고, 여기서 임의로 내리면
 *   합계가 협약서와 1원씩 어긋난다. 절사가 필요한 자리는 한도 계산(`lib/verify.ts`)뿐이다.
 */

export type PersonnelRow = {
  id: number
  연차: number
  정렬: number
  자격: string | null
  내외부: string
  표시명: string
  연구자등록번호: string | null
  소속기관: string | null
  소속부서: string | null
  직급: string | null
  국적: string | null
  신규채용여부: boolean
  월급여: number
  참여율: number
  참여개월수: number
  참여시작일: string | null
  참여종료일: string | null
  /** 현금 = 실제 급여이체 · 현물 = 기관부담 현물(급여이체 없이 참여로만 잡음). db/107 참조. */
  재원구분: "현금" | "현물"
  비고: string | null
}

/** 이 사람의 인건비 계상액. 양식의 「총액」 열. */
export function 총액(r: Pick<PersonnelRow, "월급여" | "참여율" | "참여개월수">): number {
  const v = Number(r.월급여 || 0) * (Number(r.참여율 || 0) / 100) * Number(r.참여개월수 || 0)
  return Number.isFinite(v) ? Math.round(v) : 0
}

/** 연 급여 총액. 양식의 「급여 총액」 열 — 참여율과 무관한 그 사람의 연봉이다. */
export function 급여총액(r: Pick<PersonnelRow, "월급여">): number {
  return Math.round(Number(r.월급여 || 0) * 12)
}

/**
 * 재원별 합계 — 이 값이 `budgets` 의 인건비(PERSONNEL) 줄로 들어간다.
 * 연차를 지정하면 그 연차만 센다(계상은 연차별로 협약한다).
 *
 * ⚠ 여기서는 **현금·현물 둘뿐**이다(db/107 — 지급구분 폐지, "출연금은 다 현금"으로 정리했다).
 *   그 현금이 정부출연금인지 민간부담 현금인지는 여기서 안 가른다 — 그 배정은 연구비 계상
 *   (`BudgetEditor`)의 PERSONNEL 줄에서 사람이 재원(출연금·현금·현물) 셋 중 고른다.
 *   `출연금` 키를 0으로 남겨 두는 이유는 그 화면이 세 재원을 한 표로 합칠 때 키가 비어
 *   있으면 안 되기 때문이다 — 값은 항상 이 인건비 표가 아니라 그쪽에서 채워진다.
 */
export function 재원별합계(rows: PersonnelRow[], 연차?: number) {
  const out: Record<string, number> = { 현금: 0, 현물: 0 }
  for (const r of rows) {
    if (연차 != null && Number(r.연차) !== 연차) continue
    out[r.재원구분] += 총액(r)
  }
  return out
}

/** 참여율 합이 100%를 넘는 사람이 있으면 정산에서 걸린다. 과제 단위로는 못 잡으니 이름 기준으로 센다. */
export function 참여율초과(rows: PersonnelRow[], 연차?: number): { 표시명: string; 합: number }[] {
  const 합 = new Map<string, number>()
  for (const r of rows) {
    if (연차 != null && Number(r.연차) !== 연차) continue
    합.set(r.표시명, (합.get(r.표시명) ?? 0) + Number(r.참여율 || 0))
  }
  return Array.from(합.entries())
    .filter(([, v]) => v > 100)
    .map(([표시명, v]) => ({ 표시명, 합: v }))
}
