import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 계상 확정 상태와 회사 표준 양식 조회.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다 — 네 명이 동시에 여는 파일이라 저장 충돌이 두 번 났다.
 */

export type ConfirmRow = {
  id: number
  과제_id: number
  동작: "확정" | "해제"
  사유: string | null
  총사업비_스냅샷: number | null
  배정합_스냅샷: number | null
  행위자: string
  행위자_인증: boolean
  일시: string
}

/** 지금 잠겨 있는가 + 그 근거가 된 행. 잠기지 않았으면 `확정 = false`. */
export type ConfirmState = {
  확정: boolean
  최신: ConfirmRow | null
  이력: ConfirmRow[]
}

/**
 * 과제 하나의 확정 상태.
 *
 * 현재 상태 = **가장 최근 행의 동작**. 상태 컬럼이 아니라 이력으로 두었기 때문에
 * 「누가 언제 왜 풀었는지」가 남는다(`db/100` 주석).
 */
export async function getConfirmState(과제_id: number): Promise<ConfirmState & { error: string | null }> {
  const { rows, error } = await safeSelect<ConfirmRow>("budget_confirmations", () =>
    db.from("budget_confirmations").select("*").eq("과제_id", 과제_id),
  )
  // 일시 내림차순. DB 정렬에 맡기지 않는 이유는 같은 초에 두 행이 들어오면 순서가 흔들려서다 —
  // id 로 한 번 더 갈라 준다.
  const 이력 = [...rows].sort((a, b) => b.일시.localeCompare(a.일시) || b.id - a.id)
  const 최신 = 이력[0] ?? null
  return { 확정: 최신?.동작 === "확정", 최신, 이력, error }
}

/** 전 과제의 확정 여부. 목록 화면(과제 계상 · 사업 대장)이 한 번에 읽는다. */
export async function getConfirmedProjectIds() {
  const { rows, error } = await safeSelect<ConfirmRow>("budget_confirmations", () =>
    db.from("budget_confirmations").select("*"),
  )
  const 최신: Map<number, ConfirmRow> = new Map()
  for (const r of rows) {
    const cur = 최신.get(r.과제_id)
    if (!cur || r.일시 > cur.일시 || (r.일시 === cur.일시 && r.id > cur.id)) 최신.set(r.과제_id, r)
  }
  const ids = new Set<number>()
  for (const [id, r] of 최신) if (r.동작 === "확정") ids.add(id)
  return { ids, error }
}

/* ------------------------------------------------------------------------- */

export type FormTemplate = {
  id: number
  서류명: string
  사업유형: string | null
  버전: string | null
  설명: string | null
  파일명: string
  크기: number | null
  업로더: string
  업로더_인증: boolean
  업로드일시: string
}

export const getFormTemplates = () =>
  safeSelect<FormTemplate>("form_templates", () => db.from("form_templates").select("*"))

/**
 * 서류명 하나에 적용할 표준 양식을 고른다 — **사업유형 전용이 공통을 이긴다.**
 * RCMS 지출결의서와 지자체 지출결의서는 서식이 다르다.
 */
export function pickTemplate(
  all: FormTemplate[],
   서류명: string,
   사업유형: string | null,
): FormTemplate | null {
  const 해당 = all.filter((t) => t.서류명 === 서류명)
  return (
    해당.find((t) => t.사업유형 != null && t.사업유형 === 사업유형) ??
    해당.find((t) => t.사업유형 == null) ??
    null
  )
}
