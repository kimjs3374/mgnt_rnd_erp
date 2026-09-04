"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { 단계판정 } from "@/lib/project-stage"

/**
 * 수행기간이 끝난 과제의 **저장된 `상태` 를 「종료」로 맞춘다.**
 *
 * 화면은 날짜로 단계를 계산해서 이미 사업종료로 옮겨 놨다(`lib/project-stage.ts`).
 * 그런데 `app.projects.상태` 는 그대로라, 배지는 「수행중」이고 봇(`bot/mcp_server.py`)도
 * 저장값을 읽어 옛말을 한다. 그 어긋남을 맞추는 길이다.
 *
 * ★ **조회할 때 저절로 고치지 않는다.** 목록을 여는 것만으로 DB 가 바뀌면
 *   누가 언제 무엇을 바꿨는지가 사라진다(CLAUDE.md §6-1 「핵심은 기록이다」).
 *   화면이 짚어 주고 사람이 누른다 — 자동 전환은 **보이는 단계**가 하고,
 *   **기록으로 남는 변경**은 사람이 한다.
 *
 * ⚠ 날짜를 다시 서버에서 판정한다. 화면이 보낸 id 를 그대로 믿고 종료로 찍으면,
 *   수행 중인 과제를 종료로 만드는 요청을 그대로 받아 준다.
 */
export type StageResult = { ok: boolean; error?: string; 바뀐수?: number }

/**
 * **한 걸음 앞으로** — 신청중 → 신청완료 → 수행중.
 *
 * 왜 버튼인가: 기간이 끝나는 것은 날짜가 알려 주지만 **신청을 냈다 · 선정됐다는 날짜로
 * 알 수 없다.** 사람만 안다. 그래서 이 두 걸음만 사람이 누르고, 나머지는 계산이 한다.
 *
 * ⚠ **지금 단계를 서버가 다시 판정한다.** 화면이 보낸 목표를 그대로 믿으면, 이미 수행중인
 *   과제를 신청완료로 되돌리는 요청도 받아 준다. 한 걸음씩만, 앞으로만 간다.
 *
 * ⚠ 되돌리는 길은 여기 없다. 잘못 눌렀으면 과제 상세에서 고친다 — 되돌리기를 버튼으로 주면
 *   「눌렀다 되돌렸다」가 기록 없이 남는다(CLAUDE.md §6-1).
 */
export async function 단계올리기(
  과제_ids: number[],
  목표: "신청완료" | "수행중",
): Promise<StageResult> {
  try {
    const ids = [...new Set((과제_ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    if (!ids.length) return { ok: false, error: "고른 사업이 없습니다." }
    if (목표 !== "신청완료" && 목표 !== "수행중") {
      return { ok: false, error: `옮길 수 없는 단계입니다: ${목표}` }
    }

    const { data, error } = await db.from("projects").select("*").in("id", ids)
    if (error) return { ok: false, error: error.message }

    const rows = (data ?? []).map(
      (r) => r as { id: number; 상태: string; 선정결과: string | null; 종료일: string | null },
    )
    // 한 걸음 앞일 때만 옮긴다. 두 걸음 건너뛰기도, 뒤로도 안 된다.
    const 직전: Record<string, string> = { 신청완료: "신청중", 수행중: "신청완료" }
    const 대상 = rows.filter((r) => 단계판정(r) === 직전[목표]).map((r) => r.id)

    if (!대상.length) {
      return {
        ok: false,
        error: `${직전[목표]} 단계인 사업이 없습니다. 이미 옮겨졌거나 단계가 다릅니다.`,
      }
    }

    // 무엇을 저장하는가 — 단계 자체는 저장하지 않는다. 단계를 **정하는 값**을 저장한다.
    const 바꿀값 =
      목표 === "신청완료"
        ? { 선정결과: "발표심사" }
        : { 상태: "수행중", 선정결과: "선정" }

    const { error: upErr } = await db.from("projects").update(바꿀값).in("id", 대상)
    if (upErr) return { ok: false, error: upErr.message }

    // 두 대장(지원사업·과제)과 그 단계 화면이 전부 이 값을 읽는다.
    for (const path of [
      "/projects",
      "/projects/all",
      "/projects/applying",
      "/projects/applied",
      "/projects/closed",
      "/programs",
      "/programs/applying",
      "/programs/executing",
      "/programs/closed",
      "/dashboard",
    ]) {
      revalidatePath(path)
    }
    return { ok: true, 바뀐수: 대상.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function 종료로표시(과제_ids: number[]): Promise<StageResult> {
  try {
    const ids = [...new Set((과제_ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    if (!ids.length) return { ok: false, error: "고른 과제가 없습니다." }

    // ⚠ 한글 컬럼명을 select 문자열에 넣으면 supabase-js 타입 파서가 컴파일에서 막는다.
    //    `*` 로 받고 좁혀 읽는다.
    const { data, error } = await db.from("projects").select("*").in("id", ids)
    if (error) return { ok: false, error: error.message }

    const 대상 = (data ?? [])
      .map((r) => r as { id: number; 상태: string; 선정결과: string | null; 종료일: string | null })
      // 서버가 다시 판정한다. 아직 안 끝난 과제는 여기서 걸러진다.
      .filter((r) => r.상태 !== "종료" && 단계판정(r) === "사업종료")
      .map((r) => r.id)

    if (!대상.length) {
      return { ok: false, error: "수행기간이 끝난 과제가 없습니다. 이미 맞춰져 있습니다." }
    }

    const { error: upErr } = await db
      .from("projects")
      .update({ 상태: "종료" })
      .in("id", 대상)
    if (upErr) return { ok: false, error: upErr.message }

    revalidatePath("/projects")
    revalidatePath("/projects/closed")
    revalidatePath("/projects/applying")
    revalidatePath("/programs")
    revalidatePath("/dashboard")
    return { ok: true, 바뀐수: 대상.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
