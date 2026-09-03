/**
 * 참여기간·참여율 규칙 — 순수 함수. DB 도 fetch 도 타지 않는다.
 *
 * 사용자 지시(2026-09-04) 두 가지가 여기 산다:
 *   ① 참여시작일 + 참여개월수 → **참여종료일 자동 계산**
 *   ② 내부 연구원의 **국책 과제 참여율 합계 100% 초과 금지** (민간과제는 합산 제외)
 *
 * 여기는 **정답이 하나인 자리**라 LLM 을 쓰지 않는다(CLAUDE.md §0.5 · 설계원칙 2).
 * 날짜는 `YYYY-MM-DD` **문자열 그대로** 다룬다 — `new Date()` 로 바꾸면 시간대 때문에
 * 하루가 밀려 연도·월이 바뀐다(`lib/fiscal-year.ts` 에서 같은 이유로 그렇게 하고 있다).
 */

const 날짜꼴 = /^\d{4}-\d{2}-\d{2}$/

export const 날짜 = (v: unknown): string | null => {
  const s = String(v ?? "").slice(0, 10)
  return 날짜꼴.test(s) ? s : null
}

const 이어붙이기 = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

/** 그 달의 마지막 날. 윤년까지 맞다. */
export function 말일(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 개월 더하기. 없는 날짜가 되면 그 달 말일로 당긴다(1/31 + 1개월 = 2/28). */
export function 개월더하기(iso: string, 개월: number): string | null {
  const s = 날짜(iso)
  if (!s || !Number.isFinite(개월)) return null
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const 총 = (y * 12 + (m - 1)) + Math.trunc(개월)
  const ny = Math.floor(총 / 12)
  const nm = (총 % 12) + 1
  return 이어붙이기(ny, nm, Math.min(d, 말일(ny, nm)))
}

/** 하루 빼기. */
export function 하루빼기(iso: string): string | null {
  const s = 날짜(iso)
  if (!s) return null
  let y = Number(s.slice(0, 4))
  let m = Number(s.slice(5, 7))
  let d = Number(s.slice(8, 10))
  d -= 1
  if (d === 0) {
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
    d = 말일(y, m)
  }
  return 이어붙이기(y, m, d)
}

/**
 * **참여종료일 = 참여시작일 + 참여개월수 − 1일.**
 *
 * 2022-06-01 + 24개월 = 2024-05-31 (과제 13 협약기간과 정확히 같다).
 * 2026-01-01 + 6개월 = 2026-06-30.
 *
 * ⚠ 개월수가 정수가 아니면(0.5개월 같은) **계산하지 않고 null 을 돌려준다.**
 *   반올림해 채우면 사람이 확인 안 하고 넘어가 그대로 협약에 들어간다 —
 *   짐작해 채우지 않는다(파일명으로 증빙을 자동 분류하지 않은 것과 같은 태도).
 */
export function 참여종료일계산(시작일: unknown, 개월수: unknown): string | null {
  const s = 날짜(시작일)
  const n = Number(개월수)
  if (!s || !Number.isFinite(n) || n <= 0) return null
  if (!Number.isInteger(n)) return null
  const 더한 = 개월더하기(s, n)
  return 더한 ? 하루빼기(더한) : null
}

/**
 * 참여율 합산에 넣을 과제인가 — **국책만 센다. 민간과제는 반영하지 않는다**(사용자 지시).
 *
 * ⚠ 「모르면 국책으로 본다」가 기본이다. 이유:
 *   지금 이 시스템은 **정부·지자체 지원사업만** 담는다(CLAUDE.md §0.5). 민간 유형 자체가 DB 에 없다.
 *   그리고 두 방향의 실수 값이 다르다 —
 *     · 국책인데 민간으로 빼면 → 100% 초과를 **못 잡고 RCMS 에서 걸린다**
 *     · 민간인데 국책으로 넣으면 → 저장이 막히고 사람이 이유를 보고 조정한다
 *   앞쪽이 더 나쁘다. 그래서 **민간이라고 명시된 것만** 뺀다.
 *   민간 과제를 담게 되면 `funding_schemes` 에 `PRIVATE` 를 넣고 여기 집합에 더하면 된다.
 */
export const 민간_사업유형 = new Set(["PRIVATE", "민간", "민간수탁"])

export function 국책인가(사업유형: string | null | undefined): boolean {
  return !민간_사업유형.has(String(사업유형 ?? "").trim())
}

/**
 * 두 참여기간이 겹치는가. **같은 시점에 100% 를 넘지 않아야** 하므로 기간이 안 겹치면 안 더한다.
 *
 * ⚠ 한쪽이라도 기간을 모르면 **겹친다고 본다.** 모른다고 빼면 초과를 놓치는데,
 *   그건 정산에서 걸리는 쪽이다(위 `국책인가` 와 같은 판단).
 */
export function 기간겹침(
  a: { 시작?: string | null; 끝?: string | null },
  b: { 시작?: string | null; 끝?: string | null },
): boolean {
  const as = 날짜(a.시작)
  const ae = 날짜(a.끝)
  const bs = 날짜(b.시작)
  const be = 날짜(b.끝)
  if (!as || !ae || !bs || !be) return true
  return as <= be && bs <= ae
}

/** 사람을 가리는 키. 연구자등록번호가 있으면 그것이 먼저다 — 동명이인이 있다. */
export function 사람키(r: { 표시명?: string | null; 연구자등록번호?: string | null }): string {
  const 번호 = String(r.연구자등록번호 ?? "").trim()
  if (번호) return `번호:${번호}`
  return `이름:${String(r.표시명 ?? "").trim()}`
}

export type 참여줄 = {
  과제_id: number
  과제명?: string | null
  과제코드?: string | null
  사업유형?: string | null
  표시명: string
  연구자등록번호?: string | null
  참여율: number
  참여시작일?: string | null
  참여종료일?: string | null
  /** 참여기간이 비었을 때 대신 쓸 과제 기간. */
  과제시작일?: string | null
  과제종료일?: string | null
}

const 기간 = (r: 참여줄) => ({
  시작: 날짜(r.참여시작일) ?? 날짜(r.과제시작일),
  끝: 날짜(r.참여종료일) ?? 날짜(r.과제종료일),
})

export type 초과 = {
  표시명: string
  합: number
  /** 같이 걸린 줄들 — 어느 과제 때문인지 사람이 바로 알아야 고칠 수 있다. */
  겹친것: { 과제_id: number; 라벨: string; 참여율: number }[]
  메시지: string
}

/**
 * **국책 과제 참여율 합계가 100% 를 넘는 사람**을 찾는다.
 *
 * 「지금 저장하려는 줄」과 「다른 과제에 이미 있는 줄」을 같이 넣고 부른다.
 * 같은 사람 · 국책 · **기간이 겹치는** 줄만 더한다.
 *
 * ⚠ 이 판정은 **서버에서** 해야 뜻이 있다. 화면에서만 막으면 우회된다.
 */
export function 국책참여율_초과(줄들: 참여줄[], 한도 = 100): 초과[] {
  const 국책 = 줄들.filter((r) => 국책인가(r.사업유형) && Number(r.참여율 || 0) > 0)
  const 사람별 = new Map<string, 참여줄[]>()
  for (const r of 국책) {
    const k = 사람키(r)
    사람별.set(k, [...(사람별.get(k) ?? []), r])
  }

  const out: 초과[] = []
  for (const [, rows] of 사람별) {
    // 줄마다 「그 줄과 겹치는 것들의 합」을 본다. 한 사람이 서로 안 겹치는 두 과제를
    // 50%+60% 로 하고 있으면 그건 초과가 아니다 — 시점이 다르기 때문이다.
    for (const 기준 of rows) {
      const 겹치는 = rows.filter((r) => r === 기준 || 기간겹침(기간(기준), 기간(r)))
      const 합 = 겹치는.reduce((s, r) => s + Number(r.참여율 || 0), 0)
      if (합 <= 한도) continue

      const 라벨 = (r: 참여줄) =>
        r.과제코드 || r.과제명 || `과제 ${r.과제_id}`
      const 겹친것 = 겹치는.map((r) => ({
        과제_id: r.과제_id,
        라벨: 라벨(r),
        참여율: Number(r.참여율 || 0),
      }))
      const 기간말 = (() => {
        const g = 기간(기준)
        return g.시작 && g.끝 ? ` (${g.시작}~${g.끝} 겹침)` : ""
      })()
      const 메시지 =
        `${기준.표시명}: 국책 과제 참여율 합계 ${합}% — 100% 를 넘을 수 없습니다. ` +
        겹친것.map((x) => `${x.라벨} ${x.참여율}%`).join(" + ") +
        기간말 +
        ". 민간과제는 합산하지 않습니다."

      // 같은 사람은 한 번만 보고한다 — 줄마다 찍으면 같은 말이 여러 번 나온다.
      if (!out.some((o) => o.표시명 === 기준.표시명)) {
        out.push({ 표시명: 기준.표시명, 합, 겹친것, 메시지 })
      }
      break
    }
  }
  return out
}
