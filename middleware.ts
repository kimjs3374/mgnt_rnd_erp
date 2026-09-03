import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session"

/**
 * 로그인 게이트 — rnd.mgnt.kr 전체를 로그인 뒤로 묶는다([[login-gate-decision]]).
 * 대회 규칙: "기업 실데이터가 필요한 화면은 접근 제한을 둘 것" → 로그인 사용자만 통과.
 *
 * ⚠ /api 는 일부러 뺐다. 봇·게이트웨이가 서버 대 서버로 부르는 경로라
 *   브라우저 세션 쿠키가 없다. 웹 화면(app 라우트)만 막는다.
 * ⚠ 이 미들웨어는 "로그인했는가"만 본다. RLS 는 여전히 service_role(bypassrls)로 우회 중이다
 *   — db.ts 의 안내대로 authenticated 전환은 이후 과제.
 */

const PUBLIC_PATHS = ["/login"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"

  if (isPublic) {
    return NextResponse.next()
  }

  const session = await verifySessionCookie(request.cookies.get(SESSION_COOKIE)?.value)

  if (!session) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    if (pathname !== "/") url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
