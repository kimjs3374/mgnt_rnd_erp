/**
 * 재원 분담 계산 — 정부출연금 · 민간부담금(현금 · 현물). 순수 함수. DB 도 fetch 도 타지 않는다.
 *
 * 여기도 `lib/verify.ts` 와 같은 자리다 — **정답이 하나인 계산이라 LLM 을 쓰지 않는다**
 * (CLAUDE.md §0.5 「규칙이 남는 자리는 한도·기간·참여율·금액 검산뿐」).
 * 대신 세 가지를 지킨다.
 *
 * ① **비율을 코드에 박지 않는다.** `app.funding_share_rules` 를 읽는다.
 *    같은 「정부지원 비율」이 공고마다 다르다 — 2026 지역혁신선도기업육성 공고는 중소기업
 *    75% 이내인데, 매그나텍 수행 과제는 134/137 = 97.8% 였다(CLAUDE.md §11).
 *    그래서 **공고 규칙이 규정 기본값을 이긴다.**
 * ② **근거가 확정이 아니면 자동으로 확정하지 않는다.** 상태가 「확정」이 아니거나
 *    확신도가 0.70 미만이면 값은 계산해 보여주되 사람이 저장을 눌러야 한다(설계원칙 3).
 * ③ **잔액으로 맞춘다.** 민간부담금 = 총사업비 − 정부출연금 으로 두면 절사 때문에
 *    합계가 총사업비와 1,000원 어긋나는 일이 생기지 않는다. `verify()` 의 ①번 검증이
 *    「계상 합계 = 총사업비」라 여기서 어긋나면 화면이 늘 빨간불이 된다.
 */

/** 자동 확정을 허용하는 확신도 하한. 분류 임계값과 같은 0.70 을 쓴다(CLAUDE.md §11). */
export const 자동확정_확신도 = 0.7

export type ShareRule = {
  기관유형: string
  사업유형: string | null
  announcement_id: number | null
  정부출연_상한: number
  민간현금_최소: number | null
  민간현물_최대: number | null
  간접비_상한: number | null
  절사단위: number
  원문: string
  출처: string
  상태: string
  confidence: number | null
}

export type Share = {
  총사업비: number
  정부출연금: number
  민간부담금: number
  민간부담_현금: number
  민간부담_현물: number
  /** 이 값을 사람 확인 없이 넣어도 되는지. 상태 「확정」 + 확신도 0.70 이상일 때만 true. */
  자동확정: boolean
  규칙: ShareRule
  /** 화면에 그대로 띄우는 계산 근거. 숫자마다 어디서 나왔는지 말할 수 있어야 한다. */
  근거: string[]
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원"

/**
 * 절사·절상 — 둘 다 epsilon 을 보정한다.
 * 부동소수점 때문에 8,000,000 이 7,000,000 으로 조용히 사라진 적이 있다(CLAUDE.md §7).
 * 「이내」인 상한은 내리고(floor), 「이상」인 하한은 올린다(ceil). 방향을 반대로 하면
 * 규정을 아슬아슬하게 위반하는 값이 만들어진다.
 */
export function floorTo(n: number, 자릿수: number): number {
  const unit = 10 ** 자릿수
  return Math.floor(n / unit + 1e-9) * unit
}
export function ceilTo(n: number, 자릿수: number): number {
  const unit = 10 ** 자릿수
  return Math.ceil(n / unit - 1e-9) * unit
}

/**
 * 규칙 고르기 — **공고 > 사업유형 > 기본** 순으로 이긴다.
 * 이 우선순위가 이 기능의 핵심이다. 공고에 적힌 것이 규정 일반론보다 사실에 가깝다.
 */
export function pickRule(
  rules: ShareRule[],
  ctx: { 공고_id: number | null; 사업유형: string | null; 기관유형: string | null },
): ShareRule | null {
  if (!ctx.기관유형) return null
  const 해당 = rules.filter((r) => r.기관유형 === ctx.기관유형)
  const 점수 = (r: ShareRule) =>
    (r.announcement_id != null && r.announcement_id === ctx.공고_id ? 4 : 0) +
    (r.사업유형 != null && r.사업유형 === ctx.사업유형 ? 2 : 0) +
    (r.announcement_id == null && r.사업유형 == null ? 1 : 0)
  // 점수 0 = 다른 공고·다른 사업유형 전용 규칙이다. 남의 규칙을 끌어다 쓰지 않는다.
  const 후보 = 해당.map((r) => ({ r, s: 점수(r) })).filter((x) => x.s > 0)
  if (!후보.length) return null
  후보.sort((a, b) => b.s - a.s)
  return 후보[0].r
}

/** 총사업비와 규칙 하나로 재원 구성을 만든다. 근거 문장을 같이 돌려준다. */
export function computeShare(총사업비: number | null, rule: ShareRule | null): Share | null {
  if (rule == null) return null
  if (총사업비 == null || !Number.isFinite(총사업비) || 총사업비 <= 0) return null

  const 자릿수 = Number.isFinite(rule.절사단위) ? rule.절사단위 : 3
  const 단위이름 = 자릿수 === 3 ? "천원" : `10^${자릿수}원`

  const 정부출연금 = floorTo((총사업비 * Number(rule.정부출연_상한)) / 100, 자릿수)
  const 민간부담금 = 총사업비 - 정부출연금

  const 현금최소 = rule.민간현금_최소 == null ? 0 : Number(rule.민간현금_최소)
  let 민간부담_현금 = ceilTo((민간부담금 * 현금최소) / 100, 자릿수)
  if (민간부담_현금 > 민간부담금) 민간부담_현금 = 민간부담금
  let 민간부담_현물 = 민간부담금 - 민간부담_현금

  const 근거 = [
    `총사업비 ${won(총사업비)} × 정부출연 상한 ${rule.정부출연_상한}% = ${won(정부출연금)} (${단위이름} 절사)`,
    `민간부담금 ${won(민간부담금)} = 총사업비 − 정부출연금 — 잔액으로 확정해 합계가 총사업비와 정확히 맞는다`,
  ]

  if (민간부담금 === 0) {
    근거.push("정부출연 100% 라 민간부담금이 없다")
  } else {
    근거.push(
      `민간부담금 × 현금 최소 ${현금최소}% = 현금 ${won(민간부담_현금)} (${단위이름} 절상) · 나머지가 현물`,
    )
    // 현물 상한이 걸리면 현금을 더 넣어야 한다. 「현금 최소」와 「현물 최대」가 동시에 걸린다.
    const 현물상한 =
      rule.민간현물_최대 == null
        ? null
        : floorTo((민간부담금 * Number(rule.민간현물_최대)) / 100, 자릿수)
    if (현물상한 != null && 민간부담_현물 > 현물상한) {
      민간부담_현물 = 현물상한
      민간부담_현금 = 민간부담금 - 민간부담_현물
      근거.push(
        `현물이 최대 ${rule.민간현물_최대}%(${won(현물상한)})를 넘어 현물을 상한에 맞추고 차액을 현금으로 옮겼다`,
      )
    }
  }

  const 자동확정 =
    rule.상태 === "확정" && (rule.confidence == null || Number(rule.confidence) >= 자동확정_확신도)
  근거.push(
    자동확정
      ? `근거: ${rule.원문} (${rule.출처})`
      : `⚠ 이 규칙은 「${rule.상태}」다 — 값은 계산했지만 사람이 확인하고 저장해야 한다. 근거: ${rule.원문} (${rule.출처})`,
  )

  return {
    총사업비,
    정부출연금,
    민간부담금,
    민간부담_현금,
    민간부담_현물,
    자동확정,
    규칙: rule,
    근거,
  }
}

export type ShareCheck = {
  키: "출연금" | "현금" | "현물"
  이름: string
  규정: number
  협약: number | null
  /** 협약 − 규정. 양수면 규정보다 많다. */
  차이: number | null
  /** true=규정과 같다 · false=규정을 벗어났다 · null=협약값이 비어 있어 판정하지 않았다 */
  통과: boolean | null
  설명: string
}

/**
 * 계산값과 협약서 금액을 대조한다.
 *
 * ⚠ **협약서가 이미 있으면 협약서가 사실이고 규정 계산은 점검용이다.** 덮어쓰기를 기본
 *   동작으로 두지 않는 이유다 — 협약 변경 없이 화면 숫자만 바꾸면 정산에서 반려된다.
 *   비어 있을 때만 계산값이 그대로 입력값이 된다.
 */
export function compareWithContract(
  share: Share,
   협약: { 정부지원금: number | null; 기관부담_현금: number | null; 기관부담_현물: number | null },
): ShareCheck[] {
  const rows: { 키: ShareCheck["키"]; 이름: string; 규정: number; 협약: number | null; 방향: "상한" | "하한" | "상한현물" }[] = [
    { 키: "출연금", 이름: "정부출연금", 규정: share.정부출연금, 협약: 협약.정부지원금, 방향: "상한" },
    { 키: "현금", 이름: "민간부담 현금", 규정: share.민간부담_현금, 협약: 협약.기관부담_현금, 방향: "하한" },
    { 키: "현물", 이름: "민간부담 현물", 규정: share.민간부담_현물, 협약: 협약.기관부담_현물, 방향: "상한현물" },
  ]

  return rows.map(({ 키, 이름, 규정, 협약: 값, 방향 }) => {
    if (값 == null) {
      return {
        키,
        이름,
        규정,
        협약: null,
        차이: null,
        통과: null,
        설명: "협약 금액이 비어 있다 — 계산값을 그대로 넣을 수 있다",
      }
    }
    const 차이 = 값 - 규정
    // 상한은 넘으면 위반, 하한은 미달이면 위반. 현물은 「최대」라 넘으면 위반이다.
    const 통과 = 방향 === "하한" ? 값 >= 규정 : 값 <= 규정
    const 설명 =
      차이 === 0
        ? "규정 상한과 정확히 같다"
        : 방향 === "하한"
          ? 차이 > 0
            ? `현금 최소 기준보다 ${won(차이)} 많다 — 규정 위반은 아니다`
            : `현금 최소 기준보다 ${won(-차이)} 적다 — 규정 위반이다`
          : 차이 > 0
            ? `규정 상한보다 ${won(차이)} 많다 — 규정 위반이다`
            : `규정 상한보다 ${won(-차이)} 적다 — 규정 위반은 아니다`
    return { 키, 이름, 규정, 협약: 값, 차이, 통과, 설명 }
  })
}
