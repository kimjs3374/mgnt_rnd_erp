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
