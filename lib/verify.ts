/**
 * 연구비 계상 한도 검증 — 순수 함수. DB 도 fetch 도 타지 않는다.
 *
 * 여기는 **정답이 하나인 자리**라 LLM 을 쓰지 않는다(CLAUDE.md §0.5 「규칙이 남는 자리는
 * 한도·기간·참여율·금액 검산뿐」, 설계원칙 2). 대신 두 가지를 지킨다 —
 *
 * ① **비율을 코드에 박지 않는다.** 연구수당이 수정인건비의 15% 인지 20% 인지가
 *    문서끼리 어긋나 있고(CLAUDE.md §11) 결론이 「사업마다 다름. 협약서 확인」이다.
 *    그래서 `budgets.한도비율` 을 읽는다. 비율이 없으면 **검증하지 않고 「확인 필요」로 둔다** —
 *    모르면 모른다고 한다(설계원칙 5). 틀린 「통과」가 틀린 「위반」보다 나쁘다.
 * ② **정부지원 비율 75% 를 쓰지 않는다.** §11 이 그 숫자를 「추정치다. 확인 필요」로 남겨 두었다.
 *    비율 대신 **협약서에 적힌 금액**(projects.정부지원금·기관부담_현금·기관부담_현물)과 대조한다.
 *    협약서는 추정이 아니라 사실이라 근거로 댈 수 있다.
 */

/** 비목 코드 → 직접비인지. 간접비 산정 기준액에서 무엇을 빼는지가 여기서 갈린다. */
const 직접비 = new Set(["PERSONNEL", "STUDENT", "FACILITY", "ACTIVITY", "ALLOWANCE"])

export type BudgetLine = {
  비목_대분류: string
  재원구분: string
  배정액: number
  한도비율: number | null
}

export type ContractInfo = {
  총사업비: number | null
  정부지원금: number | null
  기관부담_현금: number | null
  기관부담_현물: number | null
}

export type Check = {
  키: string
  이름: string
  /** null = 판정하지 않았다(근거가 없어서). true/false 와 구분한다. */
  통과: boolean | null
  현재: number
  기준: number | null
  /** 현재 − 기준. 양수면 초과, 음수면 미달. 판정 못 했으면 null. */
  차이: number | null
  근거: string
}

/**
 * 절사. **epsilon 을 더하고 내린다.**
 * 부동소수점 때문에 8,000,000 이 7,000,000 으로 조용히 사라진 적이 있다(CLAUDE.md §7 함정표).
 * 사람이 검산하기 전에는 아무도 모르는 종류의 오차라 여기서 한 번에 막는다.
 */
export function floorTo(n: number, 자릿수: number): number {
  const unit = 10 ** 자릿수
  return Math.floor(n / unit + 1e-9) * unit
}

const sum = (rows: BudgetLine[]) => rows.reduce((a, b) => a + Number(b.배정액 || 0), 0)

export function verify(lines: BudgetLine[], 협약: ContractInfo): Check[] {
  const out: Check[] = []
  const 비목 = (c: string) => lines.filter((l) => l.비목_대분류 === c)
  const 재원 = (s: string) => lines.filter((l) => l.재원구분 === s)
  const 계상합계 = sum(lines)

  // ① 계상 합계 = 협약 총사업비
  if (협약.총사업비 != null && 협약.총사업비 > 0) {
    out.push({
      키: "총액",
      이름: "계상 합계 = 협약 총사업비",
      통과: 계상합계 === 협약.총사업비,
      현재: 계상합계,
      기준: 협약.총사업비,
      차이: 계상합계 - 협약.총사업비,
      근거: "협약서 총사업비",
    })
  }

  // ② 재원별 계상 = 협약서 금액. 비율이 아니라 금액으로 대조한다(위 ② 참조).
  const 재원대조: [string, string, number | null][] = [
    ["출연금", "정부지원금", 협약.정부지원금],
    ["현금", "기관부담 현금", 협약.기관부담_현금],
    ["현물", "기관부담 현물", 협약.기관부담_현물],
  ]
  for (const [src, 이름, 협약액] of 재원대조) {
    const 계상 = sum(재원(src))
    // 협약서에 그 재원이 없고 계상도 0 이면 굳이 줄을 만들지 않는다. 화면이 시끄러워진다.
    if ((협약액 == null || 협약액 === 0) && 계상 === 0) continue
    out.push({
      키: `재원-${src}`,
      이름: `${src} 계상 = 협약 ${이름}`,
      통과: 협약액 == null ? null : 계상 === 협약액,
      현재: 계상,
      기준: 협약액,
      차이: 협약액 == null ? null : 계상 - 협약액,
      근거: 협약액 == null ? "협약서에 금액이 없다 — 확인 필요" : "협약서 금액",
    })
  }

  // ③ 연구수당 — 수정인건비 × 한도비율, 백원 절사.
  //    수정인건비 = 인건비(현금·현물 전부) + 학생인건비.
  //    ⚠ 연구근접지원인력 인건비는 제외해야 하는데 지금 스키마에 그 구분이 없다. 아래 근거에 적어 둔다.
  const 수당행 = 비목("ALLOWANCE")
  if (수당행.length) {
    const 수정인건비 = sum(비목("PERSONNEL")) + sum(비목("STUDENT"))
    const 비율 = 수당행.find((l) => l.한도비율 != null)?.한도비율 ?? null
    const 수당 = sum(수당행)
    const 한도 = 비율 == null ? null : floorTo((수정인건비 * Number(비율)) / 100, 2)
    out.push({
      키: "연구수당",
      이름: 비율 == null ? "연구수당 한도 (비율 미등록)" : `연구수당 수정인건비의 ${비율}% 이내`,
      통과: 한도 == null ? null : 수당 <= 한도,
      현재: 수당,
      기준: 한도,
      차이: 한도 == null ? null : 수당 - 한도,
      근거:
        한도 == null
          ? "budgets.한도비율 이 비어 있다. 협약서를 보고 채워야 판정한다"
          : `수정인건비 ${수정인건비.toLocaleString("ko-KR")}원 × ${비율}%, 백원 절사` +
            " · 연구근접지원인력 구분이 없어 인건비 전액을 기준으로 잡았다",
    })
  }

  // ④ 간접비 — (직접비 − 현물 − 위탁) × r/(100+r), 백만원 절사.
  //    곱셈이 아니라 **총액 기준 역산**이다. 직접비에 그냥 10% 를 곱하면 총액이 협약을 넘는다.
  const 간접행 = 비목("INDIRECT")
  if (간접행.length) {
    const 직접 = lines.filter((l) => 직접비.has(l.비목_대분류))
    const 직접합 = sum(직접)
    const 현물 = sum(직접.filter((l) => l.재원구분 === "현물"))
    // ⚠ 위탁연구개발비는 FACILITY 의 세부항목이라 대분류 배정액에서 떼어낼 수 없다. 0 으로 둔다.
    const 위탁 = 0
    const 기준액 = 직접합 - 현물 - 위탁
    const 비율 = 간접행.find((l) => l.한도비율 != null)?.한도비율 ?? null
    const 간접 = sum(간접행)
    const 한도 =
      비율 == null ? null : floorTo((기준액 * Number(비율)) / (100 + Number(비율)), 6)
    out.push({
      키: "간접비",
      이름: 비율 == null ? "간접비 한도 (비율 미등록)" : `간접비 ${비율}% 이내 (총액 역산)`,
      통과: 한도 == null ? null : 간접 <= 한도,
      현재: 간접,
      기준: 한도,
      차이: 한도 == null ? null : 간접 - 한도,
      근거:
        한도 == null
          ? "budgets.한도비율 이 비어 있다. 협약서를 보고 채워야 판정한다"
          : `(직접비 ${직접합.toLocaleString("ko-KR")} − 현물 ${현물.toLocaleString("ko-KR")})` +
            ` × ${비율}/(100+${비율}), 백만원 절사 · 위탁연구개발비는 세부항목이라 0 으로 뒀다`,
    })
  }

  return out
}

/** 화면에서 자주 쓰는 요약 — 위반 건수와 「판정 못 한」 건수를 나눠서 센다. */
export function summarize(checks: Check[]) {
  return {
    위반: checks.filter((c) => c.통과 === false).length,
    미판정: checks.filter((c) => c.통과 === null).length,
    통과: checks.filter((c) => c.통과 === true).length,
  }
}
