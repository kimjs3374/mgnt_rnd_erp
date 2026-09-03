/**
 * 연차는 **회계연도(1/1~12/31)** 로 센다. 기간을 12로 나누지 않는다.
 *
 * 국가 R&D 협약은 회계연도 단위로 연차를 끊는다. 그래서
 *
 *   2022-06-01 ~ 2024-05-31  → 기간은 2년이지만 **3개 연차**다
 *     1차년도 2022-06-01~2022-12-31 · 2차년도 2023 한 해 · 3차년도 2024-01-01~2024-05-31
 *
 * 예전 계산(`Math.ceil(일수 / 365.25)`)은 이걸 2로 셌다. 실제로 어긋나 있었다 —
 * P01(2025-04-01~2027-03-31)의 집행 4건이 **연차 3** 인데 계상 화면은 「협약 2년」이라
 * 3차년도 탭을 만들 수 없었다. 연차를 쓰는 자리는 전부 이 파일 하나를 본다.
 *
 * 날짜는 Postgres 가 주는 `YYYY-MM-DD` 문자열 그대로 다룬다.
 * `new Date()` 로 바꾸지 않는다 — 시간대 때문에 하루가 밀려 연도가 바뀌는 일이 실제로 있다.
 * 같은 이유로 대소 비교도 문자열로 한다(`YYYY-MM-DD` 는 사전순이 곧 날짜순이다).
 */

const 날짜 = (v: string | null | undefined): string | null => {
  const s = String(v ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

const 연도 = (d: string) => Number(d.slice(0, 4))

/** 오늘. 테스트가 기준일을 넣을 수 있게 밖으로 뺐다. */
export const 오늘 = () => new Date().toISOString().slice(0, 10)

/**
 * 협약이 걸쳐 있는 회계연도들. `[2022, 2023, 2024]`.
 * 날짜를 못 읽으면 빈 배열을 준다 — **1년이라고 지어내지 않는다**(모르면 모른다고 한다).
 */
export function 연차연도(시작일: string | null | undefined, 종료일: string | null | undefined): number[] {
  const s = 날짜(시작일)
  const e = 날짜(종료일)
  if (!s || !e || e < s) return []
  const 목록: number[] = []
  for (let y = 연도(s); y <= 연도(e); y++) 목록.push(y)
  return 목록
}

/** 총 몇 개 연차인가. 못 읽으면 0 — 화면에서 「확인 필요」로 쓰라는 뜻이다. */
export function 연차수(시작일: string | null | undefined, 종료일: string | null | undefined): number {
  return 연차연도(시작일, 종료일).length
}

/**
 * 지금 몇 년차인가. `app.projects.연차` 가 담는 값이 이것이다.
 * 시작 전이면 1차, 끝난 과제면 마지막 연차(3차년도에 끝났으면 3).
 */
export function 현재연차(
  시작일: string | null | undefined,
  종료일: string | null | undefined,
  기준일?: string,
): number {
  const s = 날짜(시작일)
  const e = 날짜(종료일)
  if (!s || !e || e < s) return 1
  const 기준 = 날짜(기준일) ?? 오늘()
  const 안쪽 = 기준 < s ? s : 기준 > e ? e : 기준
  return 연도(안쪽) - 연도(s) + 1
}

/**
 * 협약기간이 몇 개월인가. 「기간 2년」처럼 **기간**을 말할 때만 쓴다.
 * 연차 수와 헷갈리지 않게 이름을 나눠 뒀다 — 그 혼동이 이 파일이 생긴 이유다.
 */
export function 협약개월수(시작일: string | null | undefined, 종료일: string | null | undefined): number {
  const s = 날짜(시작일)
  const e = 날짜(종료일)
  if (!s || !e || e < s) return 0
  const 달 = (연도(e) - 연도(s)) * 12 + (Number(e.slice(5, 7)) - Number(s.slice(5, 7)))
  // 5/31 에 끝나면 6/1 시작분의 그 달은 다 채운 것이다. 하루라도 모자라면 안 센다.
  return Number(e.slice(8, 10)) >= Number(s.slice(8, 10)) - 1 ? 달 + 1 : 달
}

/** 「2년 (3개 연차)」처럼 사람에게 보여줄 한 줄. 기간과 연차 수를 같이 말한다. */
export function 기간표기(시작일: string | null | undefined, 종료일: string | null | undefined): string {
  const 개월 = 협약개월수(시작일, 종료일)
  const 수 = 연차수(시작일, 종료일)
  if (!수) return "기간 확인 필요"
  const 기간 = 개월 % 12 === 0 ? `${개월 / 12}년` : `${개월}개월`
  return `${기간} · ${수}개 연차`
}
