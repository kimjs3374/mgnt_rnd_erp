/**
 * 부서(연구소/기획실/임원진)·등급(슈퍼관리자)·개인 추가 메뉴 권한 기준 경로 접근 규칙 — 딱 한 곳에 둔다.
 *
 * middleware.ts(실제 접근 차단)와 components/app-sidebar.tsx(메뉴 숨김)가 이 규칙을
 * 같이 쓴다. 따로 각자 판단하게 두면(예: 사이드바는 그룹 제목으로, 미들웨어는 경로로)
 * 둘이 어긋나서 "메뉴엔 없는데 주소로는 들어가진다" 류 사고가 난다.
 *
 * ⚠ 그룹 제목이 아니라 URL 접두사로 판단한다. lib/nav.ts 의 그룹 이름·구조는
 *   자주 바뀌는데(예: "과제 관리"가 "통합 관리" 그룹 안 leaf 로 옮겨감, 2026-09-04),
 *   URL은 상대적으로 안정적이라 재구성에 안 깨진다.
 *
 * ⚠ 부서는 더 이상 기본 접근 범위를 정하지 않는다(2026-09-04 사용자 결정) — 소속
 *   표시·부서별 인원 조회용 정보일 뿐이다. 지원사업/과제사업 트랙은 슈퍼관리자가
 *   extraMenus로 개인별로 켜준 것만 보인다(기본값은 아무 트랙도 없음). 계정 관리
 *   (SUPER_ADMIN_PREFIXES)는 extraMenus 대상이 아니다 — 등급 기준 보안 경계라
 *   개인별 예외를 두면 "관리자는 슈퍼관리자가 정해준다" 원칙이 흔들린다.
 */

export type Role = "member" | "admin" | "super_admin"
export type Department = "research" | "planning" | "executive" | null
/** 슈퍼관리자가 개인별로 켜줄 수 있는 메뉴 트랙 — 부서와 무관하게 이것만이 접근을 결정한다. */
export type ExtraMenu = "research" | "planning"

// 연구소(과제사업 + 과제 관리) 전용 경로.
const RESEARCH_PREFIXES = ["/project-announcements", "/project-budgeting", "/projects", "/researchers"]
// 기획실(지원사업) 전용 경로.
const PLANNING_PREFIXES = ["/announcements", "/programs"]
// 슈퍼관리자 전용 경로.
const SUPER_ADMIN_PREFIXES = ["/admin"]

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** 이 role·extraMenus 조합이 이 경로를 볼 수 있는가. department는 표시용일 뿐 접근엔 안 쓴다. */
export function isPathAllowed(
  pathname: string,
  role: Role,
  _department: Department,
  extraMenus: readonly ExtraMenu[] = [],
): boolean {
  if (matchesPrefix(pathname, SUPER_ADMIN_PREFIXES)) return role === "super_admin"
  if (role === "super_admin") return true
  if (matchesPrefix(pathname, RESEARCH_PREFIXES)) {
    return extraMenus.includes("research")
  }
  if (matchesPrefix(pathname, PLANNING_PREFIXES)) {
    return extraMenus.includes("planning")
  }
  return true // 대시보드·회사처럼 트랙 무관 공용 경로
}
