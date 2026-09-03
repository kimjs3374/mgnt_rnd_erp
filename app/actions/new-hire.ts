"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

/**
 * 신규채용 기준연수 저장 (db/112). **사업주체마다 다르니 사람이 고친다**(2026-09-04 사용자 지시).
 *
 * 축은 `funding_share_rules` 와 같다 — 공고 > 사업유형 > 공통.
 * 화면에서는 그 과제의 **사업유형**에 저장한다(같은 사업이면 같은 기준이다).
 * 사업유형이 없는 과제면 **공통**으로 간다 — 과제 하나에만 붙는 기준은 만들지 않는다
 * (한 과제만 다르면 그건 규칙이 아니라 예외이고, 예외는 사람이 체크박스로 끈다).
 *
 * 사람이 넣은 값은 `상태='확정'` 이 된다. 기본값(제안)과 구별해야 화면이
 * 「확인 필요」를 말할 수 있다.
 */

export type NewHireRuleResult = { ok: boolean; error?: string; 기준연수?: number }

export async function saveNewHireRule(input: {
  사업유형?: string | null
  기준연수: number
  근거?: string | null
}): Promise<NewHireRuleResult> {
  try {
    const n = Math.round(Number(input.기준연수))
    if (!Number.isFinite(n) || n < 0 || n > 20) {
      return { ok: false, error: "기준연수는 0~20 사이의 정수로 넣으세요." }
    }
    const who = await getCurrentUser()
    const 사업유형 = input.사업유형?.trim() || null
    const 적용범위 = 사업유형 ? "사업유형" : "공통"

    // 범위별로 한 줄만 둔다(DB 에 부분 UNIQUE 가 걸려 있다). 있으면 고치고 없으면 넣는다.
    const { data: 기존, error: selErr } = await db
      .from("new_hire_rules")
      .select("*")
      .eq("적용범위", 적용범위)
    if (selErr) return { ok: false, error: selErr.message }

    const 같은줄 = (기존 ?? []).find((r) => {
      const row = r as { 사업유형?: string | null }
      return 적용범위 === "공통" ? true : (row.사업유형 ?? null) === 사업유형
    })

    const 값 = {
      적용범위,
      사업유형,
      announcement_id: null,
      기준연수: n,
      근거: input.근거?.trim() || null,
      // 사람이 넣었으니 확정이다. 기본값(제안)과 구별해야 「확인 필요」를 말할 수 있다.
      상태: "확정",
      수정자: who.인증 ? who.이름 : null,
      updated_at: new Date().toISOString(),
    }

    if (같은줄) {
      const { error } = await db
        .from("new_hire_rules")
        .update(값)
        .eq("id", (같은줄 as { id: number }).id)
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await db.from("new_hire_rules").insert(값)
      if (error) return { ok: false, error: error.message }
    }

    // 계상 화면 전부가 이 기준으로 기본값을 만든다. 한 과제만 갱신하면 다른 과제가 옛 기준을 쓴다.
    revalidatePath("/projects", "layout")
    return { ok: true, 기준연수: n }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
