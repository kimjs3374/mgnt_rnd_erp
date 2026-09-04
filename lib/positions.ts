/**
 * 부서·직급 목록 — 서버(계정 신청 검증)와 클라이언트(선택지 표시) 양쪽이 이 파일 하나를 본다.
 * 두 군데 따로 적으면 언젠가 어긋난다.
 */

export type Department = "research" | "planning" | "executive"

export const DEPARTMENTS: Department[] = ["executive", "planning", "research"]

export const DEPARTMENT_LABEL: Record<Department, string> = {
  executive: "임원진",
  planning: "기획실",
  research: "연구소",
}

export const POSITIONS_BY_DEPARTMENT: Record<Department, string[]> = {
  executive: ["대표", "전무", "상무", "이사"],
  planning: ["부장", "차장", "과장", "대리", "사원"],
  research: ["연구소장", "책임연구원", "선임연구원", "연구원"],
}

export function isDepartment(v: string): v is Department {
  return v === "research" || v === "planning" || v === "executive"
}
