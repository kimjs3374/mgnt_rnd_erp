/**
 * 신규채용 판정 — **공고일 기준 입사 N년 이내면 신규**. (2026-09-04 사용자 지시)
 *
 * N 은 사업주체마다 다르다. 그래서 코드에 박지 않고 `app.new_hire_rules` 에서 온다(db/112).
 * 이 파일은 순수 함수만 둔다 — 서버·클라이언트가 같이 읽고, 판정이 한 곳에서만 나오게 한다.
 *
 * ★ **기본값을 만들 뿐이다.** 사람이 체크박스를 끄면 그 판단이 이긴다(설계원칙 1 — 기록이 핵심).
 *   그래서 판정 결과를 저장하지 않고, 저장은 `personnel_costs.신규채용여부` 한 곳에만 한다.
 */

export type NewHireRule = {
  id: number
  적용범위: "공고" | "사업유형" | "공통"
  announcement_id: number | null
  사업유형: string | null
  기준연수: number
  근거: string | null
  상태: string
  수정자: string | null
  updated_at: string
}

/** 이 과제에 적용되는 규칙 하나. 공고 > 사업유형 > 공통. 없으면 null(판정하지 않는다). */
export function 규칙고르기(
  rules: NewHireRule[],
   대상: { 공고_id?: number | null; 사업유형?: string | null },
): NewHireRule | null {
  const 공고 = 대상.공고_id
    ? rules.find((r) => r.적용범위 === "공고" && r.announcement_id === 대상.공고_id)
    : undefined
  if (공고) return 공고
  const 유형 = 대상.사업유형
    ? rules.find((r) => r.적용범위 === "사업유형" && r.사업유형 === 대상.사업유형)
    : undefined
  if (유형) return 유형
  return rules.find((r) => r.적용범위 === "공통") ?? null
}

export type 기준일 = { 날짜: string | null; 무엇: string }

/**
 * 무엇을 「공고일」로 볼 것인가.
 *
 * ⚠ 실측: `app.projects.공고일` 이 12건 전부 비어 있다(케이오시 대장을 옮길 때 안 채워졌다).
 *   그래서 순서대로 찾는다 — 과제의 공고일 → 연결된 공고의 공고일 → 협약 시작일.
 *   **무엇을 썼는지 같이 돌려준다.** 어느 날짜로 판정했는지 모르면 그 판정을 검산할 수 없다.
 */
export function 기준일고르기(
  과제공고일: string | null | undefined,
  공고의공고일: string | null | undefined,
  협약시작일: string | null | undefined,
): 기준일 {
  if (과제공고일) return { 날짜: 과제공고일, 무엇: "과제에 적힌 공고일" }
  if (공고의공고일) return { 날짜: 공고의공고일, 무엇: "연결된 공고의 공고일" }
  if (협약시작일) return { 날짜: 협약시작일, 무엇: "공고일이 없어 협약 시작일" }
  return { 날짜: null, 무엇: "기준 날짜가 없다" }
}

/** `2026-03-01` 에서 N년을 뺀다. 윤년 2월 29일은 28일로 당긴다(존재하지 않는 날짜를 만들지 않는다). */
export function 연빼기(iso: string, 년: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const y = Number(m[1]) - 년
  const mo = Number(m[2])
  const d = Number(m[3])
  const 말일 = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${y}-${p(mo)}-${p(Math.min(d, 말일))}`
}

export type 신규판정 = {
  /** null = 판정하지 않았다(입사일이나 기준이 없다). false 를 「기존 인원」으로 단정하지 않는다. */
  신규: boolean | null
  근거: string
}

/**
 * **공고일 기준 입사 N년 이내면 신규.**
 *
 * 경계는 포함이다 — 기준일에서 정확히 N년 전에 입사한 사람은 「N년 이내」로 본다.
 * 입사일이 기준일보다 **뒤**여도 신규다(공고 이후 채용).
 *
 * ⚠ 입사일이 없으면 **모른다고 한다**(설계원칙 5). 없는 것을 「기존 인원」으로 밀면
 *   신규채용 가점·인건비 계상 조건을 조용히 놓친다.
 */
export function 신규채용판정(
  입사일자: string | null | undefined,
  기준: 기준일,
  기준연수: number | null | undefined,
): 신규판정 {
  if (!입사일자) {
    return { 신규: null, 근거: "명부에 입사일자가 없어 판정하지 않았습니다" }
  }
  if (!기준.날짜) {
    return { 신규: null, 근거: `${기준.무엇} — 판정할 날짜가 없습니다` }
  }
  if (기준연수 == null) {
    return { 신규: null, 근거: "신규채용 기준연수가 등록되지 않았습니다" }
  }
  const 경계 = 연빼기(기준.날짜, 기준연수)
  if (!경계) return { 신규: null, 근거: `기준일 형식을 읽지 못했습니다(${기준.날짜})` }

  const 신규 = 입사일자 >= 경계
  return {
    신규,
    근거:
      `입사 ${입사일자} · ${기준.무엇} ${기준.날짜} 기준 ${기준연수}년 이내(${경계} 이후)` +
      ` → ${신규 ? "신규채용" : "기존 인원"}`,
  }
}
