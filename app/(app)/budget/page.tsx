import { PageShell, Card } from "@/components/page-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { BUDGET, won } from "@/lib/mock"

/** 예산 — v_budget_status 하나만 읽는다. 재원구분별 소진율 + 한도 검증. */
export default function BudgetPage() {
  const 배정 = BUDGET.reduce((s, b) => s + b.배정액, 0)
  const 집행 = BUDGET.reduce((s, b) => s + b.집행액, 0)

  return (
    <PageShell
      title="예산"
      description="비목별 배정 대비 집행. 한도는 공고에서 뽑은 규칙으로 검증한다."
    >
      <Card>
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
            {BUDGET.map((b) => {
              const rate = Math.round((b.집행액 / b.배정액) * 1000) / 10
              const over = rate >= 100
              return (
                <TableRow key={b.비목 + b.재원구분} className="h-[38px] text-[13px]">
                  <TableCell className="font-medium">{b.비목}</TableCell>
                  <TableCell className="text-muted-foreground">{b.재원구분}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(b.배정액)}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(b.집행액)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(b.배정액 - b.집행액)}
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
              <TableCell colSpan={2}>합계</TableCell>
              <TableCell className="text-right tabular-nums">{won(배정)}</TableCell>
              <TableCell className="text-right tabular-nums">{won(집행)}</TableCell>
              <TableCell className="text-right tabular-nums">{won(배정 - 집행)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {Math.round((집행 / 배정) * 1000) / 10}%
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        간접비는 곱셈이 아니라 총액 기준 역산이고 절사 단위가 셋(원·백원·백만원)이라
        손으로 계산하면 틀린다. 자동 계산이 붙을 자리다.
      </p>
    </PageShell>
  )
}
