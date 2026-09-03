import { PageShell, Card } from "@/components/page-shell"
import { StatusBadge, ConfidenceBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EXPENSES, won } from "@/lib/mock"

/**
 * 집행 ★ — 우선순위에서 끝까지 지키는 화면.
 * 붙일 곳: app.expenses + app.decisions.
 * 다음 단계: 행 클릭 → 상세 모달(증빙·근거·유사 3건·정정 이력) → [비목 수정] 모달.
 */
export default function ExpensesPage() {
  return (
    <PageShell
      title="집행"
      description="Slack 에 증빙을 던지면 여기에 쌓인다. AI 가 제안하고 사람이 확정한다."
      actions={
        <>
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            ⤓ Excel
          </Button>
          <Button type="button" className="h-7 text-[12.8px]">
            + 집행 등록
          </Button>
        </>
      }
      filters={
        <>
          <Input placeholder="거래처·품목 검색" className="h-7 w-56 text-[13px]" />
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            전체 상태
          </Button>
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            전체 비목
          </Button>
          <Button type="button" variant="ghost" className="ml-auto h-7 text-[12.8px]">
            ↺ 초기화
          </Button>
        </>
      }
    >
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>일자 ⇅</TableHead>
              <TableHead>거래처 ⇅</TableHead>
              <TableHead>품목</TableHead>
              <TableHead className="text-right">합계 ⇅</TableHead>
              <TableHead>비목 › 세부항목</TableHead>
              <TableHead className="text-center">확신도</TableHead>
              <TableHead>상태 ⇅</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {EXPENSES.map((e) => (
              <TableRow key={e.id} className="h-[38px] cursor-pointer text-[13px]">
                <TableCell className="tabular-nums text-muted-foreground">
                  {e.일자}
                </TableCell>
                <TableCell className="font-medium">{e.거래처}</TableCell>
                <TableCell>{e.품목}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(e.합계)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {e.비목}
                  <span className="mx-1">›</span>
                  <span className="text-foreground">{e.세부항목}</span>
                </TableCell>
                <TableCell className="text-center">
                  <ConfidenceBadge value={e.확신도} />
                </TableCell>
                <TableCell>
                  <StatusBadge value={e.상태} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        확신도 70% 미만은 코드가 자동 확정을 막는다. 프롬프트를 믿지 않는다.
      </p>
    </PageShell>
  )
}
