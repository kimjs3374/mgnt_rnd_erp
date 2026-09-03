import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session"
import { isPathAllowed } from "@/lib/access"

/**
 * 로그인 게이트 — rnd.mgnt.kr 전체를 로그인 뒤로 묶는다([[login-gate-decision]]).
 * 대회 규칙: "기업 실데이터가 필요한 화면은 접근 제한을 둘 것" → 로그인 사용자만 통과.
 *
 * ⚠ /api 는 일부러 뺐다. 봇·게이트웨이가 서버 대 서버로 부르는 경로라
 *   브라우저 세션 쿠키가 없다. 웹 화면(app 라우트)만 막는다.
 * ⚠ 이 미들웨어는 "로그인했는가"만 본다. RLS 는 여전히 service_role(bypassrls)로 우회 중이다
 *   — db.ts 의 안내대로 authenticated 전환은 이후 과제.
 *
 * 부서(연구소/기획실)·슈퍼관리자 전용 경로 판단은 lib/access.ts 하나로 몰아둔다 —
 * 사이드바(메뉴 숨김)와 여기(실제 차단)가 같은 규칙을 봐야 어긋나지 않는다.
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

  if (!isPathAllowed(pathname, session.role, session.department)) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
