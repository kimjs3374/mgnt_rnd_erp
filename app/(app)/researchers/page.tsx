import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { ResearchersBoard } from "@/components/researchers-board"
import { getResearchers, getSalaryHistory, 월급여 } from "@/lib/queries-researchers"

export const dynamic = "force-dynamic"

/**
 * 과제 관리 > **연구원**. 내부 연구원 명부.
 *
 * 과제 밖에 두는 이유: **여러 과제가 같은 사람을 쓴다.** 과제 안에만 있으면 이름·연구자등록번호·
 * 연봉을 과제마다 다시 친다. 여기서 한 번 등록하고 인건비 계상에서 골라 넣는다.
 */
export default async function ResearchersPage() {
  const [명부, 이력] = await Promise.all([getResearchers(), getSalaryHistory()])
  const 재직 = 명부.rows.filter((r) => r.재직)
  const 연봉합 = 재직.reduce((s, r) => s + Number(r.연봉 ?? 0), 0)

  return (
    <PageShell
      title="연구원"
      description="내부 연구원 명부. 여기 등록해 두면 인건비 계상에서 골라 넣습니다 — 과제마다 다시 치지 않습니다."
    >
      {명부.error && <DbError what="연구원 명부" error={명부.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="재직 중" value={재직.length} sub={`전체 ${명부.rows.length}명`} />
        <Stat
          label="연봉 합계 (재직)"
          value={"₩" + 연봉합.toLocaleString("ko-KR")}
          sub="대략값 — 계상 기준이지 지급액이 아니다"
        />
        <Stat
          label="월급여 환산 합계"
          value={"₩" + 재직.reduce((s, r) => s + 월급여(r.연봉), 0).toLocaleString("ko-KR")}
          sub="연봉 ÷ 12, 원 단위 내림"
        />
      </div>

      <ResearchersBoard rows={명부.rows} 이력={이력.rows} />
    </PageShell>
  )
}
