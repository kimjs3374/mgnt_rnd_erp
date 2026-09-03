import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { StatusBadge, ConfidenceBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
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
import { getExpenses, won } from "@/lib/queries"
import { getLabels, categoryLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

/** 품목 jsonb 에서 사람이 읽을 이름을 뽑는다. 형태가 흔들려도 화면이 죽지 않게. */
function itemLabel(품목: unknown): string {
  if (Array.isArray(품목)) {
    const names = 품목
      .map((i) =>
        i && typeof i === "object" && "품목명" in i
          ? String((i as Record<string, unknown>).품목명)
          : i && typeof i === "object" && "name" in i
            ? String((i as Record<string, unknown>).name)
            : null,
      )
      .filter(Boolean)
    if (names.length) return names.join(", ")
  }
  return "—"
}

/**
 * 집행 ★ — 우선순위에서 끝까지 지키는 화면.
 * 다음: 행 클릭 → 상세(증빙·근거·유사 3건) → [비목 수정] 모달(정정 사유 필수).
 */
export default async function ExpensesPage() {
  const [{ rows, error }, labels] = await Promise.all([getExpenses(), getLabels()])

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
      {error && <DbError what="집행 내역" error={error} />}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="집행 내역이 없습니다"
            hint="Slack 채널에 증빙을 올리면 봇이 판독해 여기에 「검토대기」로 쌓습니다."
          />
        ) : (
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
              {rows.map((e) => (
                <TableRow key={e.id} className="h-[38px] cursor-pointer text-[13px]">
                  <TableCell className="tabular-nums text-muted-foreground">
                    {e.일자 ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{e.거래처 ?? "—"}</TableCell>
                  <TableCell>{itemLabel(e.품목)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(e.합계)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(() => {
                      const l = categoryLabel(labels, e.비목_대분류, e.비목_세부항목)
                      return (
                        <>
                          {l.main}
                          {l.sub && (
                            <>
                              <span className="mx-1">›</span>
                              <span className="text-foreground">{l.sub}</span>
                            </>
                          )}
                        </>
                      )
                    })()}
                  </TableCell>
                  <TableCell className="text-center">
                    <ConfidenceBadge value={e.ai_확신도} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={e.상태} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        확신도 70% 미만은 코드가 자동 확정을 막는다. 프롬프트를 믿지 않는다.
      </p>
    </PageShell>
  )
}
