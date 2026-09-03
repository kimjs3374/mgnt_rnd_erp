import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import { getLedger, getBudget, getExpenses, getDocuments, won } from "@/lib/queries"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  // 네 갈래를 동시에 부른다. 하나가 실패해도 나머지는 그려진다.
  const [ledger, budget, expenses, docs] = await Promise.all([
    getLedger(),
    getBudget(),
    getExpenses(),
    getDocuments(),
  ])

  const 배정 = budget.rows.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 집행 = budget.rows.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
  const 소진율 = 배정 > 0 ? Math.round((집행 / 배정) * 1000) / 10 : 0

  const 검토대기 = expenses.rows.filter((e) => e.상태 === "검토대기").length
  const 반려 = expenses.rows.filter((e) => e.상태 === "반려").length
  const 진행중 = ledger.rows.filter((r) => r.상태 !== "종료").length

  const 마감임박 = ledger.rows.filter(
    (r) => r.d_day != null && r.d_day >= 0 && r.d_day <= 30,
  )
  const 서류확인 = docs.rows.filter((d) =>
    ["만료", "만료임박", "없음", "확인필요", "공고확인필요"].includes(d.상태),
  )

  const errors = [ledger, budget, expenses, docs]
    .map((r, i) => ({ e: r.error, what: ["대장", "예산", "집행", "서류함"][i] }))
    .filter((x) => x.e)

  return (
    <PageShell title="대시보드" description="오늘 손대야 할 것만 모았다.">
      {errors.map((x) => (
        <DbError key={x.what} what={x.what} error={x.e!} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="예산 소진율"
          value={`${소진율}%`}
          sub={`${won(집행)} / ${won(배정)}`}
        />
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
        <Stat label="진행 중 사업" value={진행중} sub={`전체 ${ledger.rows.length}건`} />
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
                <li
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
                >
                  <span className="w-12 shrink-0 tabular-nums text-[var(--warning-fg)]">
                    D-{r.d_day}
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
            <EmptyState
              title="확인이 필요한 서류가 없습니다"
              hint="서류함이 비어 있으면 여기도 비어 있습니다."
            />
          ) : (
            <ul className="divide-y">
              {서류확인.map((d) => (
                <li
                  key={d.코드}
                  className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
                >
                  <span className="flex-1 truncate">{d.이름}</span>
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
