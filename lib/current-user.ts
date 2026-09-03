import "server-only"
import { cookies } from "next/headers"
import { db } from "@/lib/db"

/**
 * 지금 로그인한 사용자 — 업로드한 사람을 기록하기 위해 쓴다.
 *
 * 로그인 게이트는 김정수가 붙이는 중이고([[login-gate-decision]]) 지금은 화면이 없다.
 * 그래서 **세션이 있으면 쓰고, 없으면 없다고 말하는** 함수로 만들었다.
 * 로그인이 붙는 순간 이 파일을 고치지 않아도 실제 이메일이 기록된다.
 *
 * ⚠ 쿠키의 JWT 를 그대로 믿지 않는다. `auth.getUser(token)` 으로 **서버에 물어 검증**한다.
 *   디코딩만 하면 이메일을 위조해 「누가 올렸는지」를 조작할 수 있고,
 *   그건 정산 증빙에서 가장 믿어야 하는 값이다.
 */

export type CurrentUser = {
  id: string | null
  /** 화면·DB 에 남길 이름. 이메일이 없으면 uid 앞 8자. */
  이름: string
  /** true = 세션으로 확인됨. false = 로그인 전이라 업로더를 신뢰할 수 없다. */
  인증: boolean
}

/** 로그인 전 임시 표기. DB 에도 이 문자열이 그대로 들어가고 화면에 배지로 뜬다. */
export const 미인증_업로더 = "미인증(로그인 전)"

export async function getCurrentUser(): Promise<CurrentUser> {
  try {
    const jar = await cookies()
    // @supabase/ssr 은 토큰이 크면 `...auth-token.0`, `.1` 로 쪼개 담는다. 이름 순으로 이어 붙인다.
    const parts = jar
      .getAll()
      .filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (!parts.length) return { id: null, 이름: 미인증_업로더, 인증: false }

    let raw = parts.map((p) => p.value).join("")
    if (raw.startsWith("base64-")) {
      raw = Buffer.from(raw.slice("base64-".length), "base64").toString("utf8")
    }

    let token: string | null = null
    try {
      const parsed = JSON.parse(raw)
      token = parsed?.access_token ?? (Array.isArray(parsed) ? parsed[0] : null)
    } catch {
      // JSON 이 아니면 토큰 문자열 자체가 들어 있는 경우다.
      token = raw.startsWith("ey") ? raw : null
    }
    if (!token) return { id: null, 이름: 미인증_업로더, 인증: false }

    const { data, error } = await db.auth.getUser(token)
    if (error || !data?.user) return { id: null, 이름: 미인증_업로더, 인증: false }

    const u = data.user
    const 이름 =
      (u.user_metadata?.name as string | undefined) ??
      (u.user_metadata?.full_name as string | undefined) ??
      u.email ??
      u.id.slice(0, 8)
    return { id: u.id, 이름, 인증: true }
  } catch {
    // 쿠키를 못 읽는 상황(정적 렌더 등)에서 화면이 죽지 않게 한다.
    return { id: null, 이름: 미인증_업로더, 인증: false }
  }
}
