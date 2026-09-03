"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { 재원별합계, type PersonnelRow } from "@/lib/personnel"
// 인건비 산출은 계상의 일부다 — 확정된 과제는 여기도 잠긴다.
import { 계상잠김 } from "@/app/actions/budget-confirm"
// 국책 과제 참여율 합계 100% 초과 판정 — **다른 과제까지 읽어야** 하므로 조회 계층에 있다.
import { 국책참여율초과 } from "@/lib/queries-participation"

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
  /** 현금 = 실제 급여이체 · 현물 = 기관부담 현물. db/107 — 지급구분 폐지. */
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
    const 잠김 = await 계상잠김(과제_id)
    if (잠김) return { ok: false, error: 잠김 }

    for (const r of rows) {
      if (!r.표시명?.trim()) return { ok: false, error: "이름(표시명)이 빈 줄이 있습니다." }
      if (Number(r.참여율) < 0 || Number(r.참여율) > 100) {
        return { ok: false, error: `${r.표시명}: 참여율은 0~100 사이여야 합니다.` }
      }
      // ⚠ 「출연금」은 여기서 받지 않는다. 인건비 표는 현금·현물만 가른다(db/107) —
      //   그 현금이 정부출연금인지 민간현금인지는 연구비 계상(BudgetEditor)에서 다시 정한다.
      if (!["현금", "현물"].includes(r.재원구분)) {
        return { ok: false, error: `${r.표시명}: 재원구분은 현금·현물 중 하나여야 합니다.` }
      }
    }

    // ★ **국책 과제 참여율 합계 100% 초과를 막는다**(2026-09-04 사용자 지시).
    //   과제 하나만 보고는 판정할 수 없다 — 한 사람이 여러 과제에 걸쳐 있고, 그 합이 100% 를
    //   넘으면 정산에서 반려된다. 그래서 **다른 과제까지 읽어** 기간이 겹치는 것만 더한다.
    //   민간과제는 합산하지 않는다(`lib/participation.ts` 의 `국책인가`).
    //   ⚠ 화면에서만 막으면 우회된다. 판정은 서버에 둔다.
    //   조회가 실패하면 빈 배열이 와서 저장을 막지 않는다 — 조회 실패로 일을 세우지 않는다.
    const 참여율초과건 = await 국책참여율초과(과제_id, rows)
    if (참여율초과건.length) return { ok: false, error: 참여율초과건[0].메시지 }

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

    // 저장한 그 자리에서 비목 인건비까지 맞춘다. 사람이 버튼을 한 번 더 누르게 하지 않는다.
    const 반영 = await 인건비동기화(과제_id)

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath(`/projects/${과제_id}/settlement`)
    return { ok: true, 반영: 반영 ?? undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function deletePersonnelRow(과제_id: number, id: number): Promise<ActionResult> {
  try {
    const 잠김 = await 계상잠김(과제_id)
    if (잠김) return { ok: false, error: 잠김 }

    const { error } = await db.from("personnel_costs").delete().eq("id", id).eq("과제_id", 과제_id)
    if (error) return { ok: false, error: error.message }

    // 지운 뒤에도 맞춘다 — 사람이 빠졌으면 비목 인건비도 그만큼 줄어야 한다.
    // ★ `빈것도반영`: **지우기는 사람의 명시적인 행동**이라 합계가 0 이 되면 0 으로 반영한다.
    //   저장 경로는 그렇지 않다(아직 덜 적은 줄일 수 있다) — 아래 `인건비동기화` 주석 참고.
    const 반영 = await 인건비동기화(과제_id, { 빈것도반영: true })

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath(`/projects/${과제_id}/settlement`)
    return { ok: true, 반영: 반영 ?? undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 개인별 인건비 → **비목 인건비 자동 반영.** (2026-09-04 사용자 지시)
 *
 * 저장·삭제할 때마다 이걸 부른다. 사람이 따로 버튼을 누르지 않는다 —
 * **개인별 표가 근거고 비목 인건비는 그 합계**인데, 사람 손에 맡기면 둘이 어긋난 채로 남는다.
 * 어긋난 비목 표는 협약서·정산과 대조할 때 그대로 거짓말이 된다.
 *
 * ★ **연차를 가리지 않고 전부 더한다.** 예전에 화면이 고른 연차만 반영하는 바람에
 *   1차년도만 든 6,000,000 이 2년 합계 13,500,000 을 덮은 적이 있다(과제 13, 복구함).
 *   비목 인건비는 과제 전체의 값이라 연차로 자를 이유가 없다.
 *
 * ⚠ 개인별 줄이 **하나도 없으면 비목을 건드리지 않는다.** 12개 과제 중 개인별 계상을 쓰는 건
 *   일부뿐이고, 안 쓰는 과제의 인건비를 0 으로 밀어 버리면 그게 사고다.
 *
 * ★ 단 **`빈것도반영: true`(삭제 경로)면 0 도 반영한다.**(2026-09-04 사용자 지적)
 *   사람을 다 지웠는데 비목 인건비가 그대로 남아 있으면, 그 표가 협약·정산과 대조될 때
 *   그대로 거짓말이 된다. 「다 지웠다」와 「아직 덜 적었다」는 값으로는 구별되지 않지만
 *   **경로로는 구별된다** — 지우기는 사람의 명시적인 행동이다.
 *   0 으로 만들 때도 **줄은 남긴다**(아래 주석) — 줄어든 것이 눈에 보여야 한다.
 *
 * ⚠ 개인별에서 사라진 재원은 **0 으로 남긴다. 줄을 지우지 않는다.**
 *   지우면 「왜 줄었는지」를 아무도 못 보고, 0 이면 화면에 남아 사람이 눈으로 확인한다.
 */
async function 인건비동기화(
  과제_id: number,
  { 빈것도반영 = false }: { 빈것도반영?: boolean } = {},
): Promise<Record<string, number> | null> {
  const { data, error } = await db.from("personnel_costs").select("*").eq("과제_id", 과제_id)
  if (error) return null
  const rows = (data ?? []) as unknown as PersonnelRow[]

  const 합 = 재원별합계(rows) // 연차 인자 없음 = 전 연차 합계
  const 비었다 = !rows.length || Object.values(합).every((v) => !v || v <= 0)

  // ⚠ 합계가 0 인데 저장 경로면 손대지 않는다. 이름만 적어 두고 참여율·월급여를 아직 안 넣은
  //   줄이 흔한데(실제로 그런 행이 있었다), 그걸 근거로 비목 인건비를 0 으로 밀면 사고다.
  //   삭제 경로(`빈것도반영`)는 다르다 — 사람이 지운 것이니 0 이 사실이다.
  if (비었다 && !빈것도반영) return null

  const { data: 기존 } = await db.from("budgets").select("*").eq("과제_id", 과제_id)
  const 기존재원 = new Set(
    ((기존 ?? []) as { 비목_대분류?: string; 재원구분?: string }[])
      .filter((b) => b.비목_대분류 === "PERSONNEL")
      .map((b) => String(b.재원구분 ?? "")),
  )

  // ⚠ 금액이 0 인 재원을 **새로 만들지 않는다.** `재원별합계` 는 출연금·현금·현물 세 키를
  //   0 으로 초기화해 돌려주므로, 그대로 쓰면 쓰지도 않는 「현금 0원」 줄이 표에 생긴다.
  //   이미 있던 재원은 0 이라도 남긴다 — 줄어든 것이 눈에 보여야 한다.
  // 비었으면 **이미 있던 인건비 줄만** 0 으로 만든다. 없던 재원 줄을 새로 만들지 않는다 —
  // 쓰지도 않는 「현물 0원」 줄이 표에 생기면 그게 또 오해를 만든다.
  const 재원들 = new Set<string>(
    비었다
      ? [...기존재원]
      : [
          ...Object.entries(합)
            .filter(([, v]) => v > 0)
            .map(([k]) => k),
          ...기존재원,
        ],
  )
  const 넣을것 = [...재원들].map((재원) => ({
    과제_id,
    비목_대분류: "PERSONNEL",
    재원구분: 재원,
    배정액: Math.max(0, Math.round(합[재원] ?? 0)),
    // 인건비에는 한도비율이 없다(연구수당·간접비만 있다). null 로 둬야 검증이 오해하지 않는다.
    한도비율: null,
  }))
  // 지울 것도 없고 넣을 것도 없으면(개인별 0행 + 기존 인건비 줄 0개) 할 일이 없다.
  if (!넣을것.length) return 비었다 ? {} : null

  const { error: upErr } = await db
    .from("budgets")
    .upsert(넣을것, { onConflict: "과제_id,비목_대분류,재원구분" })
  if (upErr) return null
  return 합
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
export async function applyPersonnelToBudget(과제_id: number): Promise<ActionResult> {
  try {
    const 잠김 = await 계상잠김(과제_id)
    if (잠김) return { ok: false, error: 잠김 }

    // ⚠ 예전에는 화면이 고른 **연차만** 반영했다. 그 탓에 1차년도 6,000,000 이
    //   2년 합계 13,500,000 을 덮은 사고가 있었다. 이제 연차를 가리지 않는다.
    const 합 = await 인건비동기화(과제_id)
    if (!합) return { ok: false, error: "개인별 인건비가 아직 없습니다." }

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath(`/projects/${과제_id}/settlement`)
    return { ok: true, 반영: 합 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
