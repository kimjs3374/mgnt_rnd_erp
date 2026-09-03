import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
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
import { getLedger, won } from "@/lib/queries"

// 대장은 늘 최신이어야 한다. 빌드 시점에 굳히지 않는다.
export const dynamic = "force-dynamic"

/**
 * 지원사업 대장 — 이 시스템의 중심 화면.
 * app.v_program_ledger 뷰 하나만 읽는다. 케이오시가 엑셀로 관리하던 관리대장을 대체한다.
 */
export default async function ProgramsPage() {
  const { rows, error } = await getLedger()

  const 총지원금 = rows.reduce((s, r) => s + (r.지원금액 ?? 0), 0)
  const 총사용 = rows.reduce((s, r) => s + (r.사용금액 ?? 0), 0)
  const 점검 = rows.reduce((s, r) => s + (r.미처리점검 ?? 0), 0)
  const 서류 = rows.reduce((s, r) => s + (r.미확보서류 ?? 0), 0)

  return (
    <PageShell
      title="지원사업 대장"
      description="공고 → 자격판정 → 신청 → 선정 → 집행·증빙 → 보고. 한 건의 생애주기를 한 줄로 본다."
      actions={
        <>
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            ⤓ Excel
          </Button>
          <Button type="button" className="h-7 text-[12.8px]">
            + 사업 등록
          </Button>
        </>
      }
      filters={
        <>
          <Input placeholder="사업명·기관 검색" className="h-7 w-56 text-[13px]" />
          <span className="text-xs text-muted-foreground">상태</span>
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            전체
          </Button>
          <Button type="button" variant="ghost" className="ml-auto h-7 text-[12.8px]">
            ↺ 초기화
          </Button>
        </>
      }
    >
      {error && <DbError what="지원사업 대장" error={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="사업 수" value={rows.length} sub="검토 · 심사 · 수행 · 종료" />
        <Stat
          label="지원금액 합계"
          value={won(총지원금)}
          sub={`사용 ${won(총사용)}`}
        />
        <Stat
          label="미처리 점검"
          value={점검}
          sub="누락 · 날짜오류 · 금액 불일치"
          tone={점검 > 0 ? "warn" : "default"}
        />
        <Stat
          label="미확보 서류"
          value={서류}
          sub="필수 서류 기준"
          tone={서류 > 0 ? "warn" : "default"}
        />
      </div>

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="등록된 지원사업이 없습니다"
            hint="공고에서 신청을 시작하거나 관리대장을 가져오면 여기에 쌓입니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[280px]">사업명 ⇅</TableHead>
                <TableHead>기관 ⇅</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>마감일 ⇅</TableHead>
                <TableHead className="text-right">지원금액</TableHead>
                <TableHead className="text-right">사용금액</TableHead>
                <TableHead>결과</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">점검</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="h-[38px] text-[13px]">
                  <TableCell className="font-medium">{r.사업명}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.기관 ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.사업유형 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.마감일 ? (
                      <span>
                        {r.마감일}
                        {r.d_day != null && r.d_day >= 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            D-{r.d_day}
                          </span>
                        )}
                      </span>
                    ) : (
                      // 접수기간의 56%가 날짜가 아니다. 지어내지 않고 그대로 표시한다.
                      <span className="text-xs text-muted-foreground">확인 필요</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(r.지원금액)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(r.사용금액)}
                  </TableCell>
                  <TableCell>
                    {r.선정결과 ? <StatusBadge value={r.선정결과} /> : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={r.상태} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.미처리점검 > 0 ? (
                      <span className="text-[var(--warning-fg)]">{r.미처리점검}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageShell>
  )
}
