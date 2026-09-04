"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"

/**
 * 확정 · 정정 서버 액션.
 *
 * ★ 이 파일이 이 프로젝트의 심장이다.
 *   집행 결과만 저장하면 폴더와 똑같은 실패를 반복한다.
 *   우리 진단은 「판단 근거가 조직에 안 남는다」인데, 비목만 바꾸면 왜 바꿨는지가 또 사라진다.
 *   그래서 정정에는 **사유를 필수로 받고**, DB 제약이 그것을 강제한다
 *   (app.decisions 의 「정정하면_사유_필수」·「decisions_정정하면_유형_필수」).
 *
 *   여기서 받은 한 줄이 다음 분류의 <corrections> 로 들어가고,
 *   챗봇의 category_history 도구가 「왜 그렇게 갈랐지?」에 답할 수 있는 이유가 된다.
 */

export type ActionResult = { ok: boolean; error?: string }

const CONFIDENCE_THRESHOLD = 0.7

/** 화면과 DB 양쪽에서 막는다. 화면만 막으면 개발자도구로 뚫린다. */
const 정정사유_유형 = ["관행", "해석", "과제특수", "판독오류"] as const
type 정정유형 = (typeof 정정사유_유형)[number]

async function loadExpense(id: number) {
  const { data, error } = await db
    .from("expenses")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`집행 ${id} 을 찾을 수 없다`)
  return data as Record<string, unknown>
}

/** AI 가 무엇을 제안했는지를 판단 시점 그대로 박제한다. 나중에 바뀌어도 이력은 안 흔들린다. */
function aiSnapshot(e: Record<string, unknown>) {
  return {
    비목_대분류: e.비목_대분류 ?? null,
    비목_세부항목: e.비목_세부항목 ?? null,
    확신도: e.ai_확신도 ?? null,
    근거: e.ai_근거 ?? null,
    대안: e.ai_대안 ?? null,
  }
}

/**
 * [확정] — AI 제안을 사람이 받아들인다. (화면 이름은 2026-09-04 「이대로 확정」에서 바뀌었다)
 *
 * ⚠ **이미 확정된 건에 다시 불러도 된다.** decisions 에 한 줄이 더 쌓일 뿐이다 —
 *   증빙을 다 붙인 뒤 다시 확정하는 것이 실제로 하는 일이고, 쌓이는 것이 이 파일의 목적이다.
 *   막는 것은 화면 쪽의 **정산완료**(다시 확정하면 정산이 풀린다)와 아래 확신도 임계값뿐이다.
 */
export async function confirmExpense(id: number, 확정자: string): Promise<ActionResult> {
  try {
    const e = await loadExpense(id)
    const conf = e.ai_확신도 == null ? null : Number(e.ai_확신도)

    // ⚠ 확신도 임계값은 코드로 막는다. 「모호하면 단정하지 말라」고 지시해도 모델은 단정한다.
    if (conf != null && conf < CONFIDENCE_THRESHOLD) {
      return {
        ok: false,
        error: `확신도 ${Math.round(conf * 100)}% — 70% 미만은 그대로 확정할 수 없다. 비목을 직접 고르거나 정정하라.`,
      }
    }
    if (!e.비목_대분류) {
      return { ok: false, error: "비목이 비어 있다. 먼저 비목을 지정하라." }
    }

    const { error: dErr } = await db.from("decisions").insert({
      expense_id: id,
      ai_제안: aiSnapshot(e),
      확정_비목: e.비목_대분류,
      확정_세부항목: e.비목_세부항목 ?? null,
      정정여부: false,
      확정자,
    })
    if (dErr) return { ok: false, error: dErr.message }

    const { error: uErr } = await db
      .from("expenses")
      .update({ 상태: "확정" })
      .eq("id", id)
    if (uErr) return { ok: false, error: uErr.message }

    revalidatePath("/expenses")
    revalidatePath("/dashboard")
    revalidatePath("/settlement")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** [비목 수정] — 사람이 다른 비목으로 확정한다. **사유가 없으면 저장되지 않는다.** */
export async function correctExpense(input: {
  id: number
  비목: string
  세부항목: string | null
  유형: string
  사유: string
  확정자: string
}): Promise<ActionResult> {
  try {
    const 사유 = input.사유.trim()

    // 화면에서 막고, 여기서 또 막고, DB 제약이 마지막으로 막는다. 세 겹이다.
    if (!정정사유_유형.includes(input.유형 as 정정유형)) {
      return { ok: false, error: "정정 사유 유형을 선택하라." }
    }
    if (!사유) {
      return { ok: false, error: "왜 고쳤는지 한 줄이 필요하다. 이게 이 시스템의 전부다." }
    }

    const e = await loadExpense(input.id)
    const 바뀜 =
      e.비목_대분류 !== input.비목 || (e.비목_세부항목 ?? null) !== input.세부항목
    if (!바뀜) {
      return { ok: false, error: "비목이 그대로다. 바꿀 것이 없으면 [확정]을 쓰라." }
    }

    const { error: dErr } = await db.from("decisions").insert({
      expense_id: input.id,
      ai_제안: aiSnapshot(e),
      확정_비목: input.비목,
      확정_세부항목: input.세부항목,
      정정여부: true,
      정정사유_유형: input.유형,
      정정사유: 사유,
      확정자: input.확정자,
    })
    if (dErr) return { ok: false, error: dErr.message }

    const { error: uErr } = await db
      .from("expenses")
      .update({
        비목_대분류: input.비목,
        비목_세부항목: input.세부항목,
        상태: "확정",
      })
      .eq("id", input.id)
    if (uErr) return { ok: false, error: uErr.message }

    revalidatePath("/expenses")
    revalidatePath("/dashboard")
    revalidatePath("/settlement")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
