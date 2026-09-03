import { PageShell, Card, EmptyState } from "@/components/page-shell"
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
import { getDocuments } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 서류함 — v_document_status 를 읽는다.
 * ⚠ 서류의 **내용은 보지 않는다.** 발급일과 종류만 쓴다 — 설계 자체가 개인정보를 안 만진다.
 */
export default async function DocumentsPage() {
  const { rows, error } = await getDocuments()

  return (
    <PageShell
      title="서류함"
      description="공고가 요구하는 서류를 우리가 가지고 있는지, 아직 유효한지."
    >
      {error && <DbError what="서류 현황" error={error} />}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="등록된 서류가 없습니다"
            hint="발급일과 종류만 넣으면 만료 판정이 됩니다. 파일 내용은 보지 않습니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[280px]">서류명</TableHead>
                <TableHead>발급일</TableHead>
                <TableHead>결산연도</TableHead>
                <TableHead>만료일</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.코드} className="h-[38px] text-[13px]">
                  <TableCell className="font-medium">{d.이름}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {d.발급일 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {d.결산연도 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {d.만료일 ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={d.상태} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        유효기간은 공고가 명시하면 그것이 기본값보다 우선한다. 규칙을 못 찾으면
        「공고확인필요」로 두고 단정하지 않는다.
      </p>
    </PageShell>
  )
}
