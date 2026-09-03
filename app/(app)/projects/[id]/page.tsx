import Link from "next/link"
import { Card, Stat, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { won } from "@/lib/queries"
import { getProject, getProjectBudget, getProjectExpenses } from "@/lib/queries-project"
import { verify, summarize } from "@/lib/verify"

export const dynamic = "force-dynamic"

/** 집행으로 인정하는 상태. 「검토대기」와 「반려」는 돈이 나간 것으로 세지 않는다. */
const 집행인정 = ["확정", "제출", "정산완료"]

/**
 * 과제 개요 — 협약 · 계상 · 집행이 서로 맞는지를 한 화면에서 본다.
 * 세 숫자가 어긋나는 것이 이 업무의 사고 지점이라 셋을 나란히 둔다.
 */
export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)

  const [proj, budget, exp] = await Promise.all([
    getProject(id),
    getProjectBudget(id),
    getProjectExpenses(id),
  ])
  const p = proj.rows[0]

  const 계상 = budget.rows.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 집행 = budget.rows.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
  const 소진율 = 계상 > 0 ? Math.round((집행 / 계상) * 1000) / 10 : 0

  const checks = p
    ? verify(
        budget.rows.map((b) => ({
          비목_대분류: b.비목_대분류,
          재원구분: b.재원구분,
          배정액: b.배정액 ?? 0,
          // 한도비율이 비어 있으면 검증이 「미판정」으로 떨어진다. 그게 맞다 — 모르면 모른다고 한다.
          한도비율: b.한도비율 ?? null,
        })),
        p,
      )
    : []
  const 요약 = summarize(checks)

  const 상태별 = new Map<string, number>()
  for (const e of exp.rows) 상태별.set(e.상태, (상태별.get(e.상태) ?? 0) + 1)

  return (
    <>
      {proj.error && <DbError what="과제" error={proj.error} />}
      {budget.error && <DbError what="예산" error={budget.error} />}
      {exp.error && <DbError what="집행" error={exp.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="협약 총사업비" value={won(p?.총사업비)} sub={`정부지원금 ${won(p?.정부지원금)}`} />
        <Stat
          label="계상 합계"
          value={won(계상)}
          sub={
            p?.총사업비 == null
              ? "협약액 없음"
              : 계상 === p.총사업비
                ? "협약액과 일치"
                : `협약액과 ${won(Math.abs(계상 - p.총사업비))} 차이`
          }
          tone={p?.총사업비 != null && 계상 !== p.총사업비 ? "danger" : "default"}
        />
        <Stat label="집행액" value={won(집행)} sub={`소진율 ${소진율}%`} />
        <Stat
          label="한도 위반"
          value={요약.위반}
          sub={요약.미판정 > 0 ? `미판정 ${요약.미판정}건` : "전부 판정함"}
          tone={요약.위반 > 0 ? "danger" : 요약.미판정 > 0 ? "warn" : "default"}
        />
      </div>

      {/* 한도 검증 요약. 자세한 근거는 계상 탭에 있다. 여기선 「무엇이 걸렸는지」만. */}
      <Card className="p-4">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[13px] font-medium">한도 검증</span>
          <Link
            href={`/projects/${id}/budget`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            연구비 계상에서 고치기 →
          </Link>
        </div>
        {checks.length === 0 ? (
          <EmptyState
            title="검증할 계상이 없습니다"
            hint="연구비 계상 탭에서 비목별 배정액을 넣으면 한도를 검산합니다."
          />
        ) : (
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.키} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span
                  className={
                    c.통과 === false
                      ? "text-destructive"
                      : c.통과 === null
                        ? "text-[var(--warning-fg)]"
                        : "text-muted-foreground"
                  }
                >
                  {c.통과 === false ? "✗" : c.통과 === null ? "?" : "✓"}
                </span>
                <span>{c.이름}</span>
                <span className="tabular-nums text-muted-foreground">
                  {won(c.현재)}
                  {c.기준 != null ? ` / 기준 ${won(c.기준)}` : ""}
                </span>
                {c.차이 != null && c.차이 > 0 && (
                  <span className="tabular-nums text-destructive">
                    {won(c.차이)} 초과
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-medium">집행 상태</div>
          {exp.rows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              집행 건이 없습니다. Slack 채널에 증빙을 올리면 「검토대기」로 쌓입니다.
            </p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {[...상태별.entries()].map(([s, n]) => (
                <li key={s} className="flex justify-between">
                  <span className="text-muted-foreground">{s}</span>
                  <span className="tabular-nums">{n}건</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-1 font-medium">
                <span>집행 인정</span>
                <span className="tabular-nums">
                  {won(
                    exp.rows
                      .filter((e) => 집행인정.includes(e.상태))
                      .reduce((s, e) => s + Number(e.합계 ?? 0), 0),
                  )}
                </span>
              </li>
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-2 text-[13px] font-medium">협약 구성</div>
          <ul className="space-y-1 text-[13px]">
            <li className="flex justify-between">
              <span className="text-muted-foreground">정부지원금</span>
              <span className="tabular-nums">{won(p?.정부지원금)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">기관부담 현금</span>
              <span className="tabular-nums">{won(p?.기관부담_현금)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">기관부담 현물</span>
              <span className="tabular-nums">{won(p?.기관부담_현물)}</span>
            </li>
            <li className="flex justify-between border-t pt-1 font-medium">
              <span>총사업비</span>
              <span className="tabular-nums">{won(p?.총사업비)}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            협약서 금액이다. 계상은 이 금액에 맞춰야 하고, 어긋나면 위에 뜬다.
          </p>
        </Card>
      </div>
    </>
  )
}
