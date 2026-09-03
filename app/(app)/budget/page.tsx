import Link from "next/link"
import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getProjects, won } from "@/lib/queries"
import { getAllBudgets } from "@/lib/queries-project"
import { verify, summarize } from "@/lib/verify"

export const dynamic = "force-dynamic"

/**
 * 예산 — **과제별 한 줄**. 계상은 여기서 하지 않는다.
 *
 * ⚠ 과제가 12건이 되면서 비목을 한 표에 늘어놓는 방식이 무너졌다.
 *   어느 과제의 인건비인지 알 수 없고, 합친 소진율(배정 20.7억 대 집행 2,262만)은
 *   아무 뜻도 없는 숫자다. 무엇보다 **한도가 과제마다 다르다** —
 *   연구수당 한도는 그 과제의 수정인건비로, 간접비 한도는 그 과제의 직접비로 정해진다.
 *   합쳐 놓으면 계산 자체가 성립하지 않는다.
 *
 *   그래서 이 화면은 「어느 과제가 손이 필요한가」만 답하고,
 *   실제 계상과 검증은 `/projects/[id]/budget` 에서 한다.
 */
export default async function BudgetPage() {
  const [budget, projects] = await Promise.all([getAllBudgets(), getProjects()])

  const 묶음 = new Map<number, typeof budget.rows>()
  for (const b of budget.rows) {
    const list = 묶음.get(b.과제_id) ?? []
    list.push(b)
    묶음.set(b.과제_id, list)
  }

  // 과제 대장 순서(시작일 최신순)를 그대로 따른다. 두 화면의 정렬이 어긋나면 사람이 헷갈린다.
  const rows = projects.rows
    .filter((p) => 묶음.has(p.id))
    .map((p) => {
      const lines = 묶음.get(p.id) ?? []
      const 배정 = lines.reduce((s, b) => s + (b.배정액 ?? 0), 0)
      const 집행 = lines.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
      const checks = verify(
        lines.map((b) => ({
          비목_대분류: b.비목_대분류,
          재원구분: b.재원구분,
          배정액: b.배정액 ?? 0,
          한도비율: b.한도비율 == null ? null : Number(b.한도비율),
        })),
        p,
      )
      return {
        p,
        비목수: lines.length,
        배정,
        집행,
        소진율: 배정 > 0 ? Math.round((집행 / 배정) * 1000) / 10 : 0,
        초과: lines.filter((b) => Number(b.잔액 ?? 0) < 0).length,
        ...summarize(checks),
      }
    })

  // 계상은 있는데 과제 대장에 없는 행이 남으면 조용히 빠뜨리지 않고 알린다.
  const 미아 = [...묶음.keys()].filter((id) => !projects.rows.some((p) => p.id === id))

  const 위반과제 = rows.filter((r) => r.위반 > 0 || r.초과 > 0).length

  return (
    <PageShell
      title="예산"
      description="과제별 계상 대비 집행. 계상과 한도 검증은 과제 안에서 한다 — 한도 기준이 과제마다 다르다."
    >
      {budget.error && <DbError what="예산 현황" error={budget.error} />}
      {projects.error && <DbError what="과제 목록" error={projects.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="계상된 과제" value={rows.length} sub={`비목 ${budget.rows.length}행`} />
        <Stat
          label="배정액 합계"
          value={won(rows.reduce((s, r) => s + r.배정, 0))}
          sub="전 과제 단순 합"
        />
        <Stat
          label="집행액 합계"
          value={won(rows.reduce((s, r) => s + r.집행, 0))}
          sub="확정·제출·정산완료"
        />
        <Stat
          label="손봐야 할 과제"
          value={위반과제}
          sub="한도 위반 또는 배정 초과"
          tone={위반과제 > 0 ? "danger" : "default"}
        />
      </div>

      <Card>
        {rows.length === 0 && !budget.error ? (
          <EmptyState
            title="계상된 과제가 없습니다"
            hint="과제사업에서 과제를 열고 「연구비 계상」 탭에서 비목별 배정액을 넣으세요."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[300px]">과제</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">비목</TableHead>
                <TableHead className="text-right">배정액</TableHead>
                <TableHead className="text-right">집행액</TableHead>
                <TableHead className="w-[170px]">소진율</TableHead>
                <TableHead>한도 검증</TableHead>
                <TableHead className="w-[64px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.p.id} className="h-[42px] text-[13px]">
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${r.p.id}/budget`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.p.과제명}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.p.과제코드 ?? "과제코드 없음"}
                      {r.p.연차 ? ` · ${r.p.연차}차년도` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={r.p.상태} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.비목수}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{won(r.배정)}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(r.집행)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={
                            r.소진율 >= 100
                              ? "h-full bg-destructive"
                              : r.소진율 >= 85
                                ? "h-full bg-[var(--warning-fg)]"
                                : "h-full bg-[var(--chart-2)]"
                          }
                          style={{ width: `${Math.min(r.소진율, 100)}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right tabular-nums text-xs">
                        {r.소진율}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.위반 > 0 || r.초과 > 0 ? (
                      <span className="text-destructive">
                        {r.위반 > 0 && `한도 ${r.위반}건`}
                        {r.위반 > 0 && r.초과 > 0 && " · "}
                        {r.초과 > 0 && `배정 초과 ${r.초과}건`}
                      </span>
                    ) : r.미판정 > 0 ? (
                      <span className="text-[var(--warning-fg)]">
                        미판정 {r.미판정}건
                      </span>
                    ) : (
                      <span className="text-muted-foreground">통과 {r.통과}건</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/projects/${r.p.id}/budget`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      계상 →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {미아.length > 0 && (
        <p className="text-xs text-[var(--warning-fg)]">
          과제 대장에 없는 과제_id {미아.join(", ")} 에 계상이 남아 있습니다. 데이터를 확인하세요.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        간접비는 곱셈이 아니라 총액 기준 역산이고 절사 단위가 셋(원·백원·백만원)이라
        손으로 계산하면 틀린다. 과제를 열면 그 계산과 근거가 보인다.
      </p>
    </PageShell>
  )
}
