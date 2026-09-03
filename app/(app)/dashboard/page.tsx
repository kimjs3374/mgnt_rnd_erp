import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { LEDGER, EXPENSES, BUDGET, DOCUMENTS, won, dday } from "@/lib/mock"
import Link from "next/link"

export default function DashboardPage() {
  const 배정 = BUDGET.reduce((s, b) => s + b.배정액, 0)
  const 집행 = BUDGET.reduce((s, b) => s + b.집행액, 0)
  const 소진율 = Math.round((집행 / 배정) * 1000) / 10

  const 검토대기 = EXPENSES.filter((e) => e.상태 === "검토대기").length
  const 반려 = EXPENSES.filter((e) => e.상태 === "반려").length

  const 마감임박 = LEDGER.filter((r) => {
    const d = dday(r.마감일)
    return d != null && d >= 0 && d <= 30
  })
  const 서류확인 = DOCUMENTS.filter((d) =>
    ["만료", "만료임박", "없음", "확인필요"].includes(d.상태),
  )

  return (
    <PageShell
      title="대시보드"
      description="오늘 손대야 할 것만 모았다."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="예산 소진율" value={`${소진율}%`} sub={`${won(집행)} / ${won(배정)}`} />
        <Stat
          label="검토 대기"
          value={검토대기}
          sub="사람이 확정해야 하는 건"
          tone={검토대기 > 0 ? "warn" : "default"}
        />
        <Stat
          label="반려"
          value={반려}
          sub="사유 확인 필요"
          tone={반려 > 0 ? "danger" : "default"}
        />
        <Stat label="진행 중 사업" value={LEDGER.filter((r) => r.상태 !== "종료").length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">마감 임박 (D-30 이내)</h2>
            <Link href="/programs" className="text-xs text-primary hover:underline">
              대장 전체
            </Link>
          </div>
          {마감임박.length === 0 ? (
            <EmptyState
              title="30일 안에 마감되는 사업이 없습니다"
              hint="접수기간이 「상시」인 건은 마감일이 비어 있습니다."
            />
          ) : (
            <ul className="divide-y">
              {마감임박.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="w-12 shrink-0 tabular-nums text-[var(--warning-fg)]">
                    D-{dday(r.마감일)}
                  </span>
                  <span className="flex-1 truncate">{r.사업명}</span>
                  <span className="shrink-0 text-muted-foreground">{r.기관}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">서류 확인 필요</h2>
            <Link href="/documents" className="text-xs text-primary hover:underline">
              서류함
            </Link>
          </div>
          {서류확인.length === 0 ? (
            <EmptyState title="모든 서류가 유효합니다" />
          ) : (
            <ul className="divide-y">
              {서류확인.map((d) => (
                <li key={d.서류명} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="flex-1 truncate">{d.서류명}</span>
                  <StatusBadge value={d.상태} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  )
}
