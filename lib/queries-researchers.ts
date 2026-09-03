import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 내부 연구원 명부 조회 — `db/105_researchers.sql`.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다. 네 명이 동시에 여는 파일이라 저장 충돌이 두 번 났다
 *   (`_팀로그/memory/queries-ts-concurrent-save.md`).
 */

export type Researcher = {
  id: number
  표시명: string
  연구자등록번호: string | null
  입사일자: string | null
  소속기관: string | null
  소속부서: string | null
  직급: string | null
  내외부: string
  국적: string | null
  연봉: number
  연봉_기준연도: number | null
  재직: boolean
  비고: string | null
}

export type SalaryRow = { 연구원_id: number; 연도: number; 연봉: number; 바꾼이: string }

/** ⚠ 한글 컬럼명을 select 문자열에 넣으면 supabase-js 타입 파서가 컴파일에서 막는다. `*` 로 받는다. */
export const getResearchers = () =>
  safeSelect<Researcher>("researchers", () =>
    db.from("researchers").select("*").order("재직", { ascending: false }).order("표시명"),
  )

export const getSalaryHistory = () =>
  safeSelect<SalaryRow>("researcher_salaries", () =>
    db.from("researcher_salaries").select("*").order("연도", { ascending: false }),
  )

/**
 * 연봉 → 월급여. **인건비 계상이 월급여를 쓰기 때문에** 여기서 한 번만 환산한다.
 * 원 단위로 내린다 — 올리면 12개월 합계가 연봉을 넘는다.
 */
export const 월급여 = (연봉: number | null | undefined) =>
  Math.floor(Math.max(0, Number(연봉 ?? 0)) / 12)
