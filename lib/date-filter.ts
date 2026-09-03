/**
 * 기간 필터 한 벌 — **과제 대장과 지원사업 대장이 같은 것을 쓴다.** (2026-09-04)
 *
 * 두 화면에 같은 배열을 복사해 두면 이름이 갈린다. 실제로 「올해 걸친 것」을 「올해」로 바꾸라는
 * 지시가 왔을 때 한 곳만 고치면 다른 화면이 옛 이름을 그대로 들고 있게 된다. 그래서 한 벌만 둔다.
 *
 * ★ **겹치면 걸린다.** 「그 범위에 시작한 것」이 아니라 「그 범위에 걸쳐 있던 것」을 고른다 —
 *   2022~2024 사업은 「올해」로 걸러도 올해까지 걸쳐 있으면 나와야 한다.
 *   시작일만 보면 「올해 뭘 하고 있나」에 틀린 답을 준다.
 */

export const 기간_전체 = "전체"

export const 기간프리셋 = [
  { v: "전체", label: "기간 전체" },
  // 「올해 걸친 것」에서 **「올해」로 줄였다**(2026-09-04 사용자 지시) — 뜻은 그대로 「겹치는 것」이다.
  // 겹침 규칙은 이 파일 맨 위 주석과 `기간겹치나()` 에 적혀 있다.
  { v: "올해", label: "올해" },
  { v: "1년", label: "최근 1년" },
  { v: "3년", label: "최근 3년" },
] as const

export type 기간범위 = { 시작: string; 끝: string }

/** 프리셋 → 날짜 범위. 「전체」나 모르는 값이면 null(=거르지 않는다). */
export function 프리셋범위(v: string): 기간범위 | null {
  const 오늘 = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (v === "올해") {
    return { 시작: `${오늘.getFullYear()}-01-01`, 끝: `${오늘.getFullYear()}-12-31` }
  }
  if (v === "1년" || v === "3년") {
    const 앞 = new Date(오늘)
    앞.setFullYear(앞.getFullYear() - (v === "1년" ? 1 : 3))
    return { 시작: iso(앞), 끝: iso(오늘) }
  }
  return null
}

/** 사람이 직접 넣은 날짜가 있으면 그것이 프리셋을 이긴다 — 더 구체적인 지시이기 때문이다. */
export function 범위정하기(프리셋: string, 시작: string, 끝: string): 기간범위 | null {
  if (시작 || 끝) return { 시작, 끝 }
  return 프리셋범위(프리셋)
}

/**
 * 그 줄의 기간이 범위와 **겹치는가.**
 *
 * ⚠ 날짜가 아예 없는 줄은 기간을 걸면 빠진다. 그게 맞다 — 기간으로 확인할 대상이 아니다.
 *   모르는 것을 「걸린다」고 하면 「올해 하는 일」 목록에 근거 없는 줄이 섞인다.
 */
export function 기간겹치나(
  줄시작: string | null | undefined,
  줄종료: string | null | undefined,
  범위: 기간범위 | null,
): boolean {
  if (!범위 || (!범위.시작 && !범위.끝)) return true
  const s = String(줄시작 ?? "").slice(0, 10)
  const e = String(줄종료 ?? "").slice(0, 10)
  if (!s || !e) return false
  if (범위.끝 && s > 범위.끝) return false
  if (범위.시작 && e < 범위.시작) return false
  return true
}

/**
 * 그 줄이 걸친 **연도 목록**. 연도 드롭다운과 연도 필터가 같이 쓴다.
 * 회계연도로 센다 — 2022-06~2024-05 는 기간이 2년이어도 2022·2023·2024 세 해에 걸쳐 있다.
 */
export function 걸친연도(
  줄시작: string | null | undefined,
  줄종료: string | null | undefined,
): number[] {
  const s = Number(String(줄시작 ?? "").slice(0, 4))
  const e = Number(String(줄종료 ?? "").slice(0, 4))
  if (!s && !e) return []
  const 처음 = s || e
  const 마지막 = e || s
  if (!Number.isFinite(처음) || !Number.isFinite(마지막) || 마지막 < 처음) return []
  const out: number[] = []
  for (let y = 처음; y <= 마지막; y++) out.push(y)
  return out
}
