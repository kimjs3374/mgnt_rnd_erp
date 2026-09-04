import "server-only"
import { cookies } from "next/headers"
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session"

/**
 * 지금 로그인한 사용자 — 업로드한 사람을 기록하기 위해 쓴다.
 *
 * ⚠ 2026-09-04 변경: 로그인을 Supabase Auth 대신 자체 구현(app.users + 서명 쿠키,
 *   [[login-gate-decision]] 이후 결정)으로 바꾸면서 이 파일도 같이 바꿨다.
 *   반환 타입(id/이름/인증)은 그대로라 이 함수를 쓰던 기존 12개 파일(업로드 기록 등)은
 *   손대지 않아도 실제 로그인 사용자를 받는다. role만 새로 추가했다(추가 필드라 안전).
 */

export type CurrentUser = {
  id: string | null
  /** 화면·DB 에 남길 이름. */
  이름: string
  /** true = 세션으로 확인됨. false = 로그인 전이라 업로더를 신뢰할 수 없다. */
  인증: boolean
  role: "member" | "admin" | "super_admin" | null
  department: "research" | "planning" | "executive" | null
  extraMenus: ("research" | "planning")[]
}

/** 로그인 전 임시 표기. DB 에도 이 문자열이 그대로 들어가고 화면에 배지로 뜬다. */
export const 미인증_업로더 = "미인증(로그인 전)"

export async function getCurrentUser(): Promise<CurrentUser> {
  try {
    const jar = await cookies()
    const session = await verifySessionCookie(jar.get(SESSION_COOKIE)?.value)
    if (!session) {
      return { id: null, 이름: 미인증_업로더, 인증: false, role: null, department: null, extraMenus: [] }
    }
    return {
      id: String(session.uid),
      이름: session.name || session.username,
      인증: true,
      role: session.role,
      department: session.department,
      extraMenus: session.extraMenus ?? [],
    }
  } catch {
    // 쿠키를 못 읽는 상황(정적 렌더 등)에서 화면이 죽지 않게 한다.
    return { id: null, 이름: 미인증_업로더, 인증: false, role: null, department: null, extraMenus: [] }
  }
}
