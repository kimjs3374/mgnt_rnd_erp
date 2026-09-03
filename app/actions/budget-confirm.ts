"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { getConfirmState } from "@/lib/queries-confirm"

/**
 * 예산 확정 · 해제(버튼 이름은 「예산 확정」 — 2026-09-04 사용자 지시).
 *
 * 확정하면 **계상 탭이 읽기 전용이 된다.** (예전 주석은 「관리 위치가 사업 대장으로 넘어간다」였는데
 * 사이드바가 갈린 뒤로 사실이 아니다 — 「사업 대장」은 지원사업 쪽 화면이다. 2026-09-04 정정)
 * 계상 탭은 볼 수만 있게 되고,
 * 계상·재원·인건비를 바꾸는 서버 액션이 전부 거부한다(`계상잠김()` 을 각 액션이 부른다).
 *
 * 왜 잠가야 하나: 정산 탭의 과제비 원장이 **배정액을 기준으로** 집행과 대조한다.
 * 확정 뒤에도 배정액이 바뀌면 대조 기준이 조용히 달라지고, 그건 정산에서야 드러난다.
 *
 * ⚠ 한도 위반은 **막지 않는다.** 경고로만 말한다 —
 *   한도를 넘긴 채로 협약이 된 과제가 실제로 있고(P01 연구수당 240,000원 초과),
 *   여기서 막으면 그 과제는 영영 확정하지 못한다. 넘긴 사실은 계상 표가 이미 빨갛게 말하고 있다.
 *
 * ⚠ 권한(2026-09-04) — 예산 확정·해제는 승인성 조작이라 관리자 이상만 한다.
 */

export type ConfirmResult = { ok: boolean; error?: string; 주의?: string[] }

const 원 = (n: number) => Math.round(n).toLocaleString("ko-KR")

/**
 * **다른 액션들이 부르는 잠금 검사.** 잠겨 있으면 사람이 읽을 이유를 돌려준다.
 * 화면에서도 막지만 최종 판정은 여기다 — 화면 검사는 우회할 수 있다.
 */
export async function 계상잠김(과제_id: number): Promise<string | null> {
  const s = await getConfirmState(과제_id)
  if (!s.확정) return null
  const 언제 = s.최신?.일시?.slice(0, 10) ?? ""
  return `예산이 확정된 과제입니다(${언제} · ${s.최신?.행위자 ?? "확정자 미상"}). 고치려면 계상 탭에서 [확정 해제]를 먼저 하세요 — 사유가 남습니다.`
}

async function 합계(과제_id: number) {
  const [{ data: p }, { data: b }] = await Promise.all([
    db.from("projects").select("*").eq("id", 과제_id).limit(1),
    db.from("budgets").select("*").eq("과제_id", 과제_id),
  ])
  const 총사업비 = Number((p ?? [])[0]?.총사업비 ?? 0)
  const 배정합 = (b ?? []).reduce((s: number, r: { 배정액?: number }) => s + Number(r.배정액 ?? 0), 0)
  return { 총사업비, 배정합, 있음: (p ?? []).length > 0 }
}

export async function 계상확정(과제_id: number): Promise<ConfirmResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "예산 확정은 관리자 이상만 할 수 있습니다." }
    }

    const id = Number(과제_id)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }

    const s = await getConfirmState(id)
    if (s.확정) return { ok: false, error: "이미 확정된 과제입니다." }

    const { 총사업비, 배정합, 있음 } = await 합계(id)
    if (!있음) return { ok: false, error: "과제를 찾을 수 없다." }

    // 없으면 확정이 뜻을 잃는 것만 막는다.
    if (총사업비 <= 0) {
      return {
        ok: false,
        error: "총사업비가 정해지지 않았습니다. 연구비 계상 탭에서 재원 구성부터 먼저 채우세요.",
      }
    }
    if (배정합 === 0) {
      return { ok: false, error: "계상한 줄이 없습니다. 비목별 배정액을 먼저 넣으세요." }
    }
    if (배정합 !== 총사업비) {
      const 차 = 배정합 - 총사업비
      return {
        ok: false,
        error: `계상 합계 ${원(배정합)}원이 총사업비 ${원(총사업비)}원과 ${원(Math.abs(차))}원 ${차 > 0 ? "많습니다" : "적습니다"}. 맞춘 뒤에 확정하세요.`,
      }
    }

    const { error } = await db.from("budget_confirmations").insert({
      과제_id: id,
      동작: "확정",
      총사업비_스냅샷: 총사업비,
      배정합_스냅샷: 배정합,
      행위자: who.이름,
      행위자_인증: who.인증,
    })
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/projects/${id}/budget`)
    revalidatePath(`/projects/${id}`)
    revalidatePath("/projects")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 해제 — **사유가 없으면 저장되지 않는다.** 화면·여기·DB 제약 세 겹이 막는다. */
export async function 계상확정해제(과제_id: number, 사유: string): Promise<ConfirmResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "예산 확정 해제는 관리자 이상만 할 수 있습니다." }
    }

    const id = Number(과제_id)
    const 이유 = (사유 ?? "").trim()
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }
    if (!이유) {
      return { ok: false, error: "왜 다시 여는지 한 줄이 필요합니다. 정산 기준이 바뀌는 일입니다." }
    }

    const s = await getConfirmState(id)
    if (!s.확정) return { ok: false, error: "확정된 상태가 아닙니다." }

    const { 총사업비, 배정합 } = await 합계(id)
    const { error } = await db.from("budget_confirmations").insert({
      과제_id: id,
      동작: "해제",
      사유: 이유,
      총사업비_스냅샷: 총사업비,
      배정합_스냅샷: 배정합,
      행위자: who.이름,
      행위자_인증: who.인증,
    })
    if (error) return { ok: false, error: error.message }

    const 주의: string[] = []
    // 확정 때와 금액이 달라졌으면 말한다. 스냅샷을 남긴 이유가 이것이다.
    if (s.최신?.총사업비_스냅샷 != null && Number(s.최신.총사업비_스냅샷) !== 총사업비) {
      주의.push(
        `확정할 때 총사업비는 ${원(Number(s.최신.총사업비_스냅샷))}원이었는데 지금은 ${원(총사업비)}원입니다.`,
      )
    }

    revalidatePath(`/projects/${id}/budget`)
    revalidatePath(`/projects/${id}`)
    revalidatePath("/projects")
    return { ok: true, 주의 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
