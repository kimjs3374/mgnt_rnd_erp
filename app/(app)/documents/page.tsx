import { PageShell, Card } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DOCUMENTS } from "@/lib/mock"

/**
 * 서류함 — v_document_status 를 읽는다.
 * ⚠ 서류의 **내용은 보지 않는다.** 발급일과 종류만 쓴다 — 설계 자체가 개인정보를 안 만진다.
 */
export default function DocumentsPage() {
  return (
    <PageShell
      title="서류함"
      description="공고가 요구하는 서류를 우리가 가지고 있는지, 아직 유효한지."
    >
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[280px]">서류명</TableHead>
              <TableHead>발급일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>근거</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DOCUMENTS.map((d) => (
              <TableRow key={d.서류명} className="h-[38px] text-[13px]">
                <TableCell className="font-medium">{d.서류명}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {d.발급일 ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge value={d.상태} />
                </TableCell>
                <TableCell className="text-muted-foreground">{d.비고}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        유효기간은 공고가 명시하면 그것이 기본값보다 우선한다. 규칙을 못 찾으면
        「확인 필요」로 두고 단정하지 않는다.
      </p>
    </PageShell>
  )
}
