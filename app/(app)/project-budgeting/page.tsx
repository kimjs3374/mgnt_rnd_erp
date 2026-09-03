import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { BudgetingBoard } from "@/components/budgeting-board"
import { WatchlistStrip } from "@/components/watchlist-strip"
import { getBudgetingRows, getWatchlistAnnouncements, 단계이름 } from "@/lib/queries-budgeting"
import { won } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > **과제 계상**.
 *
 * 메뉴 순서가 곧 일의 순서다 — 공고 탐색 → **과제 계상** → 사업 대장.
 * 공고를 보고, 지원하고, 선정되면 **여기서 사업비를 잡고**, 그 결과가 대장에 쌓인다.
 *
 * 이 화면이 메우는 구멍: `[지원 등록]`이 만드는 줄은 협약 전이라 **총사업비가 0**이다.
 * 선정이 나도 그 0이 그대로라 계상 화면에 가면 나눌 기준이 없다. 선정된 건이 어디까지 왔는지
 * 한 자리에서 보여주고, 협약 금액을 그 공고의 규정으로 나눠 채워 계상으로 보낸다.
 *
 * ⚠ 비목 배정은 여기서 하지 않는다 — `/projects/[id]/budget` 이 이미 한다.
 *   같은 일을 두 화면에 두면 한쪽만 고쳐진다.
 */
export default async function ProjectBudgetingPage() {
  const [{ rows, error, 기관유형, 규칙수 }, 관심] = await Promise.all([
    getBudgetingRows(),
    getWatchlistAnnouncements(),
  ])

  const 셈 = (단계: string) => rows.filter((r) => r.단계 === 단계).length
  const 미확정 = 셈("사업비_미확정")
  const 미계상 = 셈("미계상")
  const 진행중 = 셈("진행중")
  const 완료 = 셈("완료")
  const 초과 = 셈("초과")
  const 남은합 = rows
    .filter((r) => r.총사업비 > 0 && r.남은액 > 0)
    .reduce((s, r) => s + r.남은액, 0)

  return (
    <PageShell
      title="과제 계상"
      description="선정된 과제가 사업비를 잡을 때까지를 한 자리에서 본다. 공고에서 온 건은 그 공고의 재원 분담 규정이 그대로 적용된다."
    >
      {error && <DbError what="과제 계상" error={error} />}
      {관심.error && <DbError what="관심 공고" error={관심.error} />}

      {/* 관심 공고가 먼저다 — 마감이 지나가는 공고는 계상할 과제보다 급하다. */}
      <WatchlistStrip rows={관심.rows} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="사업비 미확정"
          value={미확정}
          sub="선정됐지만 협약 금액이 0이라 비목을 나눌 기준이 없다"
          tone={미확정 > 0 ? "warn" : "default"}
        />
        <Stat
          label="계상 전 · 계상 중"
          value={`${미계상} · ${진행중}`}
          sub={남은합 > 0 ? `아직 안 잡은 금액 ${won(남은합)}` : "남은 금액 없음"}
          tone={미계상 + 진행중 > 0 ? "warn" : "default"}
        />
        <Stat label="계상 완료" value={완료} sub="배정 합계 = 총사업비" />
        <Stat
          label="총사업비 초과"
          value={초과}
          sub={초과 > 0 ? "배정이 총사업비를 넘었다 — 계상 화면에서 줄여야 한다" : "없음"}
          tone={초과 > 0 ? "danger" : "default"}
        />
      </div>

      {규칙수 === 0 && (
        <p className="text-xs text-[var(--warning-fg)]">
          재원 분담 규칙이 한 건도 없습니다 — 협약금액을 넣어도 정부출연금·민간부담을 나눌 수
          없습니다. <code>db/93_funding_share_rules.sql</code> 을 먼저 적용하세요.
        </p>
      )}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="계상할 과제가 없습니다"
            hint="공고 탐색에서 지원을 등록하고 [선정]으로 기록하면 여기에 뜹니다."
          />
        ) : (
          <BudgetingBoard rows={rows} 단계이름={단계이름} 기관유형={기관유형} />
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        공고 → 지원 등록 → 선정 → <b>여기서 협약금액 확정</b> → 연구비 계상 탭에서 비목 배정.
        비목을 나누는 일은 과제 안(연구비 계상)에서 합니다 — 한도가 과제마다 달라서 합쳐 놓으면
        계산 자체가 성립하지 않기 때문입니다.
      </p>
    </PageShell>
  )
}
