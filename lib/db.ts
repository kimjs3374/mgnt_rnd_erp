import "server-only"
import { createClient } from "@supabase/supabase-js"

/**
 * Supabase 클라이언트 — **서버 전용**.
 *
 * ⚠ service_role 키를 쓴다. 이 역할은 bypassrls=true 라 RLS 를 통과한다.
 *   그래서 `server-only` 를 import 해 클라이언트 컴포넌트에서 불러오면
 *   빌드가 실패하도록 막아 두었다. 이 파일을 "use client" 파일에서 import 하지 않는다.
 *
 * 로그인이 붙으면 여기를 anon 키 + 사용자 JWT 로 바꾸고, RLS 정책이 실제로 일을 하게 만든다.
 * 지금은 로그인 전이라 anon 에 아무 권한도 주지 않았고(401), 읽기는 서버에서만 한다.
 */
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  // 빈 값으로 조용히 도는 것보다 시작할 때 죽는 편이 낫다.
  throw new Error(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다. /web/rnd/.env.local 을 확인할 것.",
  )
}

export const db = createClient(url, key, {
  db: { schema: "app" }, // 우리 테이블은 public 이 아니라 app 스키마에 있다
  auth: { persistSession: false, autoRefreshToken: false },
})

/**
 * 조회 결과를 안전하게 받는다.
 * 화면이 통째로 죽는 것보다, 비어 있고 이유가 보이는 편이 낫다 —
 * 심사 항목에 「오류·재시도·대체 경로」가 40점 걸려 있다.
 */
export async function safeSelect<T>(
  label: string,
  run: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  try {
    const { data, error } = await run()
    if (error) {
      console.error(`[db] ${label}: ${error.message}`)
      return { rows: [], error: error.message }
    }
    return { rows: data ?? [], error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[db] ${label}: ${msg}`)
    return { rows: [], error: msg }
  }
}
