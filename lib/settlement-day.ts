/**
 * 매월 정산일과 D-day — 순수 함수. (2026-09-04 사용자 지시)
 *
 * ★ **규칙과 공휴일을 코드에 박지 않는다.** 「회계 일정은 매번 달라진다」고 해서
 *   기준일·이동방식·공휴일·그 달만 다른 마감일을 전부 **DB 에서 읽어 넘긴다**(`db/114`).
 *   코드에 박으면 고칠 때마다 배포해야 하고, 대회 뒤에 쓸 사람은 못 고친다.
 *   (CLAUDE.md §0.5 「사업유형은 데이터다. 코드에 박지 않는다」와 같은 태도.)
 *
 * 날짜는 `YYYY-MM-DD` **문자열 그대로** 다룬다 — `new Date()` 로 바꾸면 시간대 때문에
 * 하루가 밀린다(`lib/fiscal-year.ts` · `lib/participation.ts` 와 같은 이유).
 */

export type 이동방식 = "앞" | "뒤" | "그대로"

export type 정산규칙 = {
  기준일: number
  이동: 이동방식
}

export type 공휴일 = { 날짜: string; 이름: string; 확인필요: boolean }

/** 그 달만 다른 마감일. `연월` 은 `YYYY-MM`. */
export type 달마다 = { 연월: string; 마감일: string; 사유?: string | null }

export const 기본규칙: 정산규칙 = { 기준일: 25, 이동: "앞" }

const 날짜꼴 = /^\d{4}-\d{2}-\d{2}$/
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

/** 그 달의 마지막 날. 31일로 잡아 둔 달에 30일밖에 없으면 말일로 당긴다. */
export function 말일(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function 요일(날: string): number {
  const [y, m, d] = 날.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export const 주말인가 = (날: string) => 요일(날) === 0 || 요일(날) === 6

function 옮기기(날: string, 며칠: number): string {
  const [y, m, d] = 날.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + 며칠)
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export const 오늘 = () => new Date().toISOString().slice(0, 10)

const 요일이름 = ["일", "월", "화", "수", "목", "금", "토"]

export type 정산일 = {
  /** 실제 마감일. */
  날: string
  /** 규칙이 만든 원래 날(그 달 기준일). 옮겨졌는지 보여주려고 같이 준다. */
  원래: string
  옮겨짐: boolean
  이유: "주말" | "공휴일" | null
  /** 사람이 그 달만 따로 잡아 둔 날인가. 그러면 규칙보다 이게 이긴다. */
  달지정: boolean
  달지정사유: string | null
  요일: string
  /** 오늘로부터 며칠 남았나. 0 이면 오늘이다. */
  남은일: number
  /** 판단에 **확인이 필요한 공휴일**(음력)이 끼었나. */
  확인필요: boolean
  /** 지금 쓰인 규칙 — 화면이 그대로 보여 준다. */
  규칙: 정산규칙
}

function 일수차(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((p(b) - p(a)) / 86400000)
}

/**
 * 그 달의 정산일. **그 달만 따로 잡아 둔 날이 있으면 그것이 이긴다** — 회계 일정이
 * 달마다 바뀌는 자리라, 규칙으로 못 담는 예외는 사람이 직접 넣는다.
 */
export function 그달정산일(
  y: number,
  m: number,
  규칙: 정산규칙,
  공휴일들: 공휴일[],
  달마다들: 달마다[],
): { 날: string; 원래: string; 옮겨짐: boolean; 이유: "주말" | "공휴일" | null; 달지정: boolean; 달지정사유: string | null; 확인필요: boolean } {
  const 연월 = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`
  const 콕 = 달마다들.find((o) => o.연월 === 연월)
  if (콕 && 날짜꼴.test(String(콕.마감일).slice(0, 10))) {
    const 날 = String(콕.마감일).slice(0, 10)
    return {
      날,
      원래: 날,
      옮겨짐: false,
      이유: null,
      달지정: true,
      달지정사유: 콕.사유 ?? null,
      확인필요: false,
    }
  }

  const 공휴일맵 = new Map(공휴일들.map((h) => [String(h.날짜).slice(0, 10), h]))
  const 쉬는날 = (날: string) => 주말인가(날) || 공휴일맵.has(날)

  // 기준일이 그 달에 없으면(2월 31일) 말일로 당긴다.
  const 원래 = iso(y, m, Math.min(규칙.기준일, 말일(y, m)))

  if (규칙.이동 === "그대로") {
    return { 날: 원래, 원래, 옮겨짐: false, 이유: null, 달지정: false, 달지정사유: null, 확인필요: false }
  }

  const 걸음 = 규칙.이동 === "앞" ? -1 : 1
  let 날 = 원래
  let 확인필요 = false
  // 열흘이면 어떤 연휴도 넘는다. 무한 루프를 코드로 막는다.
  for (let i = 0; i < 10 && 쉬는날(날); i++) {
    const h = 공휴일맵.get(날)
    if (h?.확인필요) 확인필요 = true
    날 = 옮기기(날, 걸음)
  }

  const 옮겨짐 = 날 !== 원래
  const 이유 = !옮겨짐 ? null : 공휴일맵.has(원래) ? "공휴일" : "주말"
  return { 날, 원래, 옮겨짐, 이유, 달지정: false, 달지정사유: null, 확인필요 }
}

/**
 * **다음 정산일.** 이번 달 정산일이 아직 안 지났으면 그것, 지났으면 다음 달.
 * 오늘이 정산일이면 오늘(D-0)이다 — 「오늘이 마감」이 제일 중요한 말이다.
 */
export function 다음정산일(
  옵션: { 규칙?: 정산규칙; 공휴일?: 공휴일[]; 달마다?: 달마다[]; 기준일?: string } = {},
): 정산일 {
  const 규칙 = 옵션.규칙 ?? 기본규칙
  const 공휴일들 = 옵션.공휴일 ?? []
  const 달마다들 = 옵션.달마다 ?? []
  const 오 = 옵션.기준일 ?? 오늘()
  const [y, m] = 오.split("-").map(Number)

  let r = 그달정산일(y, m, 규칙, 공휴일들, 달마다들)
  if (일수차(오, r.날) < 0) {
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    r = 그달정산일(ny, nm, 규칙, 공휴일들, 달마다들)
  }

  return {
    ...r,
    요일: 요일이름[요일(r.날)],
    남은일: 일수차(오, r.날),
    규칙,
  }
}
