/**
 * 부서(연구소/기획실)·등급(슈퍼관리자) 기준 경로 접근 규칙 — 딱 한 곳에 둔다.
 *
 * middleware.ts(실제 접근 차단)와 components/app-sidebar.tsx(메뉴 숨김)가 이 규칙을
 * 같이 쓴다. 따로 각자 판단하게 두면(예: 사이드바는 그룹 제목으로, 미들웨어는 경로로)
 * 둘이 어긋나서 "메뉴엔 없는데 주소로는 들어가진다" 류 사고가 난다.
 *
 * ⚠ 그룹 제목이 아니라 URL 접두사로 판단한다. lib/nav.ts 의 그룹 이름·구조는
 *   자주 바뀌는데(예: "과제 관리"가 "통합 관리" 그룹 안 leaf 로 옮겨감, 2026-09-04),
 *   URL은 상대적으로 안정적이라 재구성에 안 깨진다.
 */

export type Role = "member" | "admin" | "super_admin"
export type Department = "research" | "planning" | null

// 연구소(과제사업 + 과제 관리) 전용 경로.
const RESEARCH_PREFIXES = ["/project-announcements", "/project-budgeting", "/projects", "/researchers"]
// 기획실(지원사업) 전용 경로.
const PLANNING_PREFIXES = ["/announcements", "/programs"]
// 슈퍼관리자 전용 경로.
const SUPER_ADMIN_PREFIXES = ["/admin"]

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** 이 role·department 조합이 이 경로를 볼 수 있는가. */
export function isPathAllowed(pathname: string, role: Role, department: Department): boolean {
  if (matchesPrefix(pathname, SUPER_ADMIN_PREFIXES)) return role === "super_admin"
  if (role === "super_admin") return true
  if (matchesPrefix(pathname, RESEARCH_PREFIXES)) return department === "research"
  if (matchesPrefix(pathname, PLANNING_PREFIXES)) return department === "planning"
  return true // 대시보드·회사처럼 부서 무관 공용 경로
}
