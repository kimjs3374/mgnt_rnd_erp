import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getBudget, won } from "@/lib/queries"

export const dynamic = "force-dynamic"

/** 예산 — v_budget_status 하나만 읽는다. */
export default async function BudgetPage() {
  const { rows, error } = await getBudget()

  const 배정 = rows.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 집행 = rows.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)

  return (
    <PageShell
      title="예산"
      description="비목별 배정 대비 집행. 한도는 공고에서 뽑은 규칙으로 검증한다."
    >
      {error && <DbError what="예산 현황" error={error} />}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="배정된 예산이 없습니다"
            hint="과제에 비목별 배정액을 등록하면 소진율이 계산됩니다."
          />
        ) : (
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
                              over ? "h-full bg-destructive" : "h-full bg-[var(--chart-2)]"
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
                <TableCell colSpan={2}>합계</TableCell>
                <TableCell className="text-right tabular-nums">{won(배정)}</TableCell>
                <TableCell className="text-right tabular-nums">{won(집행)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(배정 - 집행)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {배정 > 0 ? Math.round((집행 / 배정) * 1000) / 10 : 0}%
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        간접비는 곱셈이 아니라 총액 기준 역산이고 절사 단위가 셋(원·백원·백만원)이라
        손으로 계산하면 틀린다. 자동 계산이 붙을 자리다.
      </p>
    </PageShell>
  )
}
