import Link from "next/link"
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
import { getSettlement, won } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 정산 — RCMS 입력 직전 상태를 완성해두는 화면.
 * ⚠ RCMS 는 외부 API 가 없다. 「연동」이라고 쓰지 않는다.
 */
export default async function SettlementPage() {
  const { rows, error } = await getSettlement()

  return (
    <PageShell
      title="정산"
      description="과제별 정산 진행 상황. 과제를 열면 과제비 원장과 RCMS 입력 대조표가 있다."
    >
      {error && <DbError what="정산 현황" error={error} />}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="정산 대기 건이 없습니다"
            hint="집행이 「확정」되면 여기에 제출 순서대로 쌓입니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>과제</TableHead>
                <TableHead className="text-right">연차</TableHead>
                <TableHead className="text-right">집행건수</TableHead>
                <TableHead className="text-right">검토대기</TableHead>
                <TableHead className="text-right">확정</TableHead>
                <TableHead className="text-right">제출</TableHead>
                <TableHead className="text-right">반려</TableHead>
                <TableHead className="text-right">집행액</TableHead>
                <TableHead className="text-right">증빙미비</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={`${s.과제_id}-${s.연차}`} className="h-[38px] text-[14.3px]">
                  <TableCell className="font-medium">
                    {/* RCMS 대조표와 사용 건은 과제 안에 있다. 여기는 어느 과제를 열지 고르는 자리다. */}
                    <Link
                      href={`/projects/${s.과제_id}/settlement`}
                      className="underline-offset-2 hover:underline"
                    >
                      {s.과제명}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.연차 ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.집행건수}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.검토대기}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.확정}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.제출}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.반려 > 0 ? (
                      <span className="text-destructive">{s.반려}</span>
                    ) : (
                      s.반려
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(Number(s.집행액))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.증빙미비건수 > 0 ? (
                      <span className="text-[var(--warning-fg)]">{s.증빙미비건수}</span>
                    ) : (
                      s.증빙미비건수
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="rounded-lg border bg-card p-4 text-[14.3px] text-muted-foreground">
        지자체·TP 사업은 선집행 후 세금계산서·이체증을 제출하고, 국가 R&D 는 RCMS 에 입력한다.
        <span className="text-foreground"> 사업유형에 따라 절차가 갈린다 —</span> 코드에 박지 않고
        데이터로 둔 이유다.
      </div>
    </PageShell>
  )
}
