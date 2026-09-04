import "server-only"
import { db, safeSelect } from "@/lib/db"

export type CheckRow = {
  id: number
  과제_id: number
  과제명: string
  종류: string
  심각도: string
  대상: string | null
  내용: string
  근거: string | null
  created_at: string
}

type CheckRaw = {
  id: number
  과제_id: number
  종류: string
  심각도: string
  대상: string | null
  내용: string
  근거: string | null
  처리: string
  created_at: string
}

/**
 * 제출 전 점검 — 미처리만 가져온다. `scripts/check-programs.mjs`(계산, LLM 없음)가 채운다.
 * ⚠ 이 파일을 새로 두는 이유 — `lib/queries.ts` 는 네 명이 동시에 여는 파일이라 저장 충돌이
 *   난 적이 있다(`_팀로그/memory/queries-ts-concurrent-save.md`). 여기는 그 파일을 안 건드린다.
 */
export async function getUnresolvedChecks() {
  const [checks, projects] = await Promise.all([
    safeSelect<CheckRaw>("program_checks", () =>
      db.from("program_checks").select("*").eq("처리", "미처리"),
    ),
    safeSelect<{ id: number; 과제명: string }>("projects", () =>
      db.from("projects").select("*"),
    ),
  ])

  const 과제명 = new Map(projects.rows.map((p) => [p.id, p.과제명]))

  const rows: CheckRow[] = checks.rows
    .map((c) => ({
      id: c.id,
      과제_id: c.과제_id,
      과제명: 과제명.get(c.과제_id) ?? "이름 없는 과제",
      종류: c.종류,
      심각도: c.심각도,
      대상: c.대상,
      내용: c.내용,
      근거: c.근거,
      created_at: c.created_at,
    }))
    // 심각도가 높은 것, 최근 것이 위로.
    .sort((a, b) => {
      const 순위 = (s: string) => (s === "오류" ? 0 : s === "경고" ? 1 : 2)
      return 순위(a.심각도) - 순위(b.심각도) || b.created_at.localeCompare(a.created_at)
    })

  return { rows, error: checks.error ?? projects.error ?? null }
}
