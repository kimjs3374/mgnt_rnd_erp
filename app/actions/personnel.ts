"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { 재원별합계, type PersonnelRow } from "@/lib/personnel"

/**
 * 개인별 인건비 계상 — 저장 · 삭제 · 인건비 비목 반영.
 *
 * 여기에도 AI 는 없다. 사람이 참여율과 월급여를 넣고, 코드가 곱해서 합계를 낸다
 * (설계원칙 2 — 계산으로 확정되는 것은 LLM 에게 맡기지 않는다).
 *
 * ⚠ 실명·실제 급여를 공개 URL 에 올리지 않는다(CLAUDE.md §5 절대규칙 5).
 *   그래서 컬럼 이름이 `표시명` 이고, 화면에도 그 경고를 띄운다. 막지는 않는다 —
 *   로그인 게이트가 붙은 뒤에는 실제 값을 넣어야 쓸 수 있는 기능이기 때문이다.
 */

export type ActionResult = { ok: boolean; error?: string; 반영?: Record<string, number> }

type 입력 = {
  id?: number | null
  연차: number
  정렬?: number
  자격?: string | null
  내외부?: string
  표시명: string
  연구자등록번호?: string | null
  소속기관?: string | null
  소속부서?: string | null
  직급?: string | null
  국적?: string | null
  신규채용여부?: boolean
  월급여: number
  참여율: number
  참여개월수: number
  참여시작일?: string | null
  참여종료일?: string | null
  지급구분: string
  재원구분: string
  비고?: string | null
}

const 정수 = (v: unknown) => {
  const n = Math.round(Number(v ?? 0))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export async function savePersonnelRows(과제_id: number, rows: 입력[]): Promise<ActionResult> {
  try {
    if (!Number.isInteger(과제_id) || 과제_id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }

    for (const r of rows) {
      if (!r.표시명?.trim()) return { ok: false, error: "이름(표시명)이 빈 줄이 있습니다." }
      if (Number(r.참여율) < 0 || Number(r.참여율) > 100) {
        return { ok: false, error: `${r.표시명}: 참여율은 0~100 사이여야 합니다.` }
      }
      if (!["지급", "미지급"].includes(r.지급구분)) {
        return { ok: false, error: `${r.표시명}: 지급구분이 이상합니다.` }
      }
      if (!["출연금", "현금", "현물"].includes(r.재원구분)) {
        return { ok: false, error: `${r.표시명}: 재원구분이 이상합니다.` }
      }
    }

    // 새 줄과 기존 줄을 나눠 넣는다. upsert 로 한 번에 하면 id 없는 줄에 null 이 들어가 터진다.
    const 기존 = rows.filter((r) => r.id != null)
    const 신규 = rows.filter((r) => r.id == null)

    const 행으로 = (r: 입력) => ({
      과제_id,
      연차: 정수(r.연차) || 1,
      정렬: 정수(r.정렬),
      자격: r.자격 ?? null,
      내외부: r.내외부 ?? "내부",
      표시명: r.표시명.trim(),
      연구자등록번호: r.연구자등록번호 ?? null,
      소속기관: r.소속기관 ?? null,
      소속부서: r.소속부서 ?? null,
      직급: r.직급 ?? null,
      국적: r.국적 ?? null,
      신규채용여부: Boolean(r.신규채용여부),
      월급여: 정수(r.월급여),
      참여율: Number(r.참여율) || 0,
      참여개월수: Number(r.참여개월수) || 0,
      참여시작일: r.참여시작일 || null,
      참여종료일: r.참여종료일 || null,
      지급구분: r.지급구분,
      재원구분: r.재원구분,
      비고: r.비고 ?? null,
    })

    if (신규.length) {
      const { error } = await db.from("personnel_costs").insert(신규.map(행으로))
      if (error) return { ok: false, error: error.message }
    }
    for (const r of 기존) {
      const { error } = await db
        .from("personnel_costs")
        .update(행으로(r))
        .eq("id", r.id as number)
        .eq("과제_id", 과제_id)
      if (error) return { ok: false, error: error.message }
    }

    revalidatePath(`/projects/${과제_id}/budget`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function deletePersonnelRow(과제_id: number, id: number): Promise<ActionResult> {
  try {
    const { error } = await db.from("personnel_costs").delete().eq("id", id).eq("과제_id", 과제_id)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/projects/${과제_id}/budget`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 개인별 합계를 **연구비 계상의 인건비 줄로 보낸다.**
 *
 * `budgets` 의 (과제, PERSONNEL, 재원) 줄을 개인별 합계로 덮어쓴다. 재원별로 따로 —
 * 지급(현금)과 미지급(현물)은 협약서에서도 다른 금액이고, 간접비 기준액에서 현물을 빼기 때문이다.
 *
 * ⚠ 개인별 표에 없는 재원의 기존 인건비 줄은 **지우지 않고 0 으로 두지도 않는다.**
 *   손으로 넣어 둔 값을 조용히 없애면 「왜 줄었는지」를 아무도 모른다. 화면에 남겨 사람이 지운다.
 */
export async function applyPersonnelToBudget(
  과제_id: number,
  연차?: number,
): Promise<ActionResult> {
  try {
    const { data, error } = await db
      .from("personnel_costs")
      .select("*")
      .eq("과제_id", 과제_id)
    if (error) return { ok: false, error: error.message }

    const rows = (data ?? []) as unknown as PersonnelRow[]
    if (!rows.length) return { ok: false, error: "개인별 인건비가 아직 없습니다." }

    const 합 = 재원별합계(rows, 연차)
    const 넣을것 = Object.entries(합)
      .filter(([, v]) => v > 0)
      .map(([재원, 액]) => ({
        과제_id,
        비목_대분류: "PERSONNEL",
        재원구분: 재원,
        배정액: 액,
        // 인건비에는 한도비율이 없다(연구수당·간접비만 있다). null 로 둬야 검증이 오해하지 않는다.
        한도비율: null,
      }))
    if (!넣을것.length) return { ok: false, error: "합계가 0 입니다. 월급여·참여율을 확인하세요." }

    const { error: upErr } = await db
      .from("budgets")
      .upsert(넣을것, { onConflict: "과제_id,비목_대분류,재원구분" })
    if (upErr) return { ok: false, error: upErr.message }

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath(`/projects/${과제_id}/settlement`)
    return { ok: true, 반영: 합 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
