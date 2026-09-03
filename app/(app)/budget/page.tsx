import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getBudget, getProjects, won } from "@/lib/queries"

export const dynamic = "force-dynamic"

// 비목은 규정 순서가 있다. DB 가 돌려주는 순서(입력순)로 두면 화면마다 순서가 달라진다.
const 비목순서: Record<string, number> = {
  PERSONNEL: 1,
  STUDENT: 2,
  FACILITY: 3,
  ACTIVITY: 4,
  ALLOWANCE: 5,
  INDIRECT: 6,
}

/**
 * 예산 — v_budget_status + projects.
 *
 * ⚠ 과제별로 끊어서 본다. 과제가 1건일 땐 평평한 표로도 읽혔지만 12건이 되니
 *   비목만 나열하면 어느 과제의 인건비인지 알 수 없고, 전 과제를 합친 소진율은
 *   (배정 20억 대 집행 2천만) 아무 뜻도 없는 숫자가 된다.
 *   합계는 과제 안에서만 의미가 있어서 소계를 과제마다 붙이고 전체 합계는 없앴다.
 */
export default async function BudgetPage() {
  const [budget, projects] = await Promise.all([getBudget(), getProjects()])

  const 과제 = new Map(projects.rows.map((p) => [p.id, p]))

  // 과제_id 로 묶는다. 뷰가 과제를 섞어서 주기 때문에 화면에서 다시 모은다.
  const 묶음 = new Map<number, typeof budget.rows>()
  for (const b of budget.rows) {
    const list = 묶음.get(b.과제_id) ?? []
    list.push(b)
    묶음.set(b.과제_id, list)
  }

  // 과제 목록 순서(시작일 최신순)를 그대로 따른다 — 두 화면의 정렬이 어긋나면 사람이 헷갈린다.
  const 순서 = projects.rows.map((p) => p.id).filter((id) => 묶음.has(id))
  // 과제 대장에 없는 과제_id 가 남으면 뒤에 붙인다. 조용히 빠뜨리지 않는다.
  for (const id of 묶음.keys()) if (!순서.includes(id)) 순서.push(id)

  const 총배정 = budget.rows.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 총집행 = budget.rows.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
  const 집행있는과제 = 순서.filter((id) =>
    (묶음.get(id) ?? []).some((b) => Number(b.집행액 ?? 0) > 0),
  ).length

  return (
    <PageShell
      title="예산"
      description="과제별 비목 배정 대비 집행. 한도는 공고에서 뽑은 규칙으로 검증한다."
    >
      {budget.error && <DbError what="예산 현황" error={budget.error} />}
      {projects.error && <DbError what="과제 목록" error={projects.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="배정된 과제" value={순서.length} sub={`집행 시작 ${집행있는과제}건`} />
        <Stat label="배정액 합계" value={won(총배정)} sub="전 과제 단순 합" />
        <Stat label="집행액 합계" value={won(총집행)} sub="확정·제출·정산완료" />
        <Stat label="비목 행" value={budget.rows.length} sub="과제 × 비목 × 재원" />
      </div>

      {순서.length === 0 && !budget.error ? (
        <Card>
          <EmptyState
            title="배정된 예산이 없습니다"
            hint="과제에 비목별 배정액을 등록하면 소진율이 계산됩니다."
          />
        </Card>
      ) : (
        순서.map((id) => {
          const rows = (묶음.get(id) ?? [])
            .slice()
            .sort(
              (a, b) =>
                (비목순서[a.비목_대분류] ?? 99) - (비목순서[b.비목_대분류] ?? 99) ||
                a.재원구분.localeCompare(b.재원구분, "ko"),
            )
          const p = 과제.get(id)
          const 배정 = rows.reduce((s, b) => s + (b.배정액 ?? 0), 0)
          const 집행 = rows.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
          const 소계율 = 배정 > 0 ? Math.round((집행 / 배정) * 1000) / 10 : 0

          return (
            <Card key={id}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium">
                  {p?.과제명 ?? `과제 #${id}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p?.과제코드 ?? "과제 대장에 없음"}
                  {p?.연차 ? ` · ${p.연차}차년도` : ""}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  배정 {won(배정)} · 집행 {won(집행)} · {소계율}%
                </span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>비목</TableHead>
                    <TableHead>재원구분</TableHead>
                    <TableHead className="text-right">배정액</TableHead>
                    <TableHead className="text-right">집행액</TableHead>
                    <TableHead className="text-right">잔액</TableHead>
                    <TableHead className="w-[180px]">소진율</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b, i) => {
                    const rate = Number(b.소진율 ?? 0)
                    const over = rate >= 100
                    return (
                      <TableRow
                        key={`${b.과제_id}-${b.비목_대분류}-${b.재원구분}-${i}`}
                        className="h-[38px] text-[13px]"
                      >
                        <TableCell className="font-medium">
                          {b.비목명 ?? b.비목_대분류}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.재원구분}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {won(b.배정액)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {won(Number(b.집행액))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {won(Number(b.잔액))}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                              <div
                                className={
                                  over
                                    ? "h-full bg-destructive"
                                    : "h-full bg-[var(--chart-2)]"
                                }
                                style={{ width: `${Math.min(rate, 100)}%` }}
                              />
                            </div>
                            <span className="w-12 shrink-0 text-right tabular-nums text-xs">
                              {rate}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  <TableRow className="h-[38px] bg-secondary/40 text-[13px] font-medium hover:bg-secondary/40">
                    <TableCell colSpan={2}>소계</TableCell>
                    <TableCell className="text-right tabular-nums">{won(배정)}</TableCell>
                    <TableCell className="text-right tabular-nums">{won(집행)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {won(배정 - 집행)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{소계율}%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          )
        })
      )}

      <p className="text-xs text-muted-foreground">
        간접비는 곱셈이 아니라 총액 기준 역산이고 절사 단위가 셋(원·백원·백만원)이라
        손으로 계산하면 틀린다. 자동 계산이 붙을 자리다.
      </p>
    </PageShell>
  )
}
