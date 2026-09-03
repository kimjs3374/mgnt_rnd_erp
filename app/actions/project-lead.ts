"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

/**
 * 연구책임자 — 읽기는 대장이 하고, **바꾸는 길은 여기 하나뿐이다.**
 *
 * 사용자 지시: 「중간에 변경될 수도 있으니 수정할 수 있게 (나중에 권한을 주기 위함)」.
 * 그래서 두 가지를 미리 맞춰 뒀다.
 *
 *   ① **권한을 볼 자리를 한 곳으로 모았다** — `수정권한()`. 지금은 전부 통과시키지만,
 *      역할이 생기면 **이 함수만** 고치면 된다. 화면에 흩어 놓으면 나중에 다 뒤져야 하고
 *      한 군데를 빠뜨리면 그게 구멍이 된다.
 *   ② **바꾼 자취를 남긴다** — `app.project_lead_log`. 권한은 결국 「누가 바꿀 수 있나」인데,
 *      바꾼 사람을 안 남기면 권한을 붙여도 확인할 방법이 없다(CLAUDE.md §6-1).
 *
 * ⚠ `app.projects` 는 `supabase_admin` 소유라 컬럼을 못 붙인다. 값은 옆 테이블
 *   `app.project_leads` 에 1:1 로 있다(`db/104_project_lead.sql`).
 *
 * ⚠ 개인정보: 이 값은 사람 이름이고 배포 URL 은 열려 있다(절대규칙 5).
 *   **서버가 실명을 걸러낼 방법은 없다** — 넣는 사람이 판단할 일이라 화면에 안내를 띄운다.
 *   대신 길이·줄바꿈처럼 **기계가 판정할 수 있는 것만** 여기서 막는다.
 */

/** 표시명 최대 길이. 이름 칸이지 메모 칸이 아니다. */
const 최대길이 = 40

export type LeadResult = { ok: boolean; error?: string; 표시명?: string }

/**
 * 지금 이 사람이 연구책임자를 바꿀 수 있나.
 *
 * **지금은 아무도 막지 않는다.** 로그인 게이트가 아직 붙는 중이고([[login-gate-decision]]),
 * 여기서 먼저 막으면 로그인 화면이 없는 동안 아무도 못 고친다.
 * 대신 **인증 여부는 그대로 기록**해서, 권한이 붙은 뒤에 지난 변경을 가려낼 수 있게 한다.
 *
 * 권한을 붙일 때 고칠 곳은 여기 한 줄이다. 예:
 *   if (!user.인증) return { 허용: false, 이유: "로그인이 필요합니다." }
 *   if (!(await 역할확인(user.id, "과제관리"))) return { 허용: false, 이유: "권한이 없습니다." }
 */
async function 수정권한(_user: { id: string | null; 인증: boolean }) {
  return { 허용: true as boolean, 이유: "" }
}

function 다듬기(v: string): string {
  // 줄바꿈·연속 공백을 하나로. 붙여넣기로 들어온 표가 이름 칸에 그대로 앉는 일을 막는다.
  return v.replace(/\s+/g, " ").trim()
}

export async function setProjectLead(입력: {
  과제_id: number
  표시명: string
  사유?: string
}): Promise<LeadResult> {
  try {
    const 과제_id = Number(입력.과제_id)
    if (!Number.isInteger(과제_id) || 과제_id <= 0) return { ok: false, error: "과제를 찾을 수 없습니다." }

    const 새값 = 다듬기(String(입력.표시명 ?? ""))
    if (!새값) return { ok: false, error: "연구책임자를 비워 둘 수 없습니다." }
    if (새값.length > 최대길이) {
      return { ok: false, error: `연구책임자는 ${최대길이}자까지 넣을 수 있습니다.` }
    }

    const user = await getCurrentUser()
    const 권한 = await 수정권한(user)
    if (!권한.허용) return { ok: false, error: 권한.이유 || "바꿀 수 없습니다." }

    // 그 과제가 실제로 있는지 먼저 본다. 없는 과제로 이력만 쌓이면 나중에 못 읽는다.
    const { data: proj, error: projErr } = await db
      .from("projects")
      .select("*")
      .eq("id", 과제_id)
      .limit(1)
    if (projErr) return { ok: false, error: projErr.message }
    if (!(proj ?? []).length) return { ok: false, error: "과제를 찾을 수 없습니다." }

    // ⚠ 한글 컬럼명을 select 문자열에 넣으면 supabase-js 의 타입 파서가 컴파일에서 막는다.
    //    `*` 로 받고 좁혀 읽는다 — queries.ts 도 같은 이유로 그렇게 돼 있다.
    const { data: 지금, error: readErr } = await db
      .from("project_leads")
      .select("*")
      .eq("과제_id", 과제_id)
      .limit(1)
    if (readErr) return { ok: false, error: readErr.message }
    const 이전 = ((지금 ?? [])[0] as { 표시명?: string } | undefined)?.표시명 ?? null

    // 안 바뀌었으면 이력에 줄을 만들지 않는다. 저장을 두 번 눌렀다고 「변경 2건」이 되면 안 된다.
    if (이전 === 새값) return { ok: true, 표시명: 새값 }

    const { error: upErr } = await db.from("project_leads").upsert(
      {
        과제_id,
        표시명: 새값,
        바꾼이: user.이름,
        바꾼이_인증: user.인증,
        바꾼일시: new Date().toISOString(),
      },
      { onConflict: "과제_id" },
    )
    if (upErr) return { ok: false, error: upErr.message }

    // 이력은 실패해도 본 작업을 되돌리지 않는다. 값은 이미 맞고, 자취가 빠진 것은
    // 화면을 죽여서 될 일이 아니다. 대신 조용히 넘기지 않고 서버 로그에 남긴다.
    const { error: logErr } = await db.from("project_lead_log").insert({
      과제_id,
      이전,
      이후: 새값,
      바꾼이: user.이름,
      바꾼이_인증: user.인증,
      사유: 다듬기(String(입력.사유 ?? "")) || null,
    })
    if (logErr) console.error("[project-lead] 이력 기록 실패", logErr.message)

    revalidatePath("/projects")
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath("/programs")
    return { ok: true, 표시명: 새값 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
