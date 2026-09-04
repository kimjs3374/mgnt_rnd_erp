import Link from "next/link"
import { Card, Stat, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { FundingShareCard } from "@/components/funding-share-card"
import { won } from "@/lib/queries"
import {
  getProject,
  getProjectBudget,
  getProjectExpenses,
  getFundingShareRules,
  getCompanyProfile,
} from "@/lib/queries-project"
import { getConfirmState } from "@/lib/queries-confirm"
import { pickRule, computeShare } from "@/lib/funding-share"
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

  const [proj, budget, exp, rules, company, confirm] = await Promise.all([
    getProject(id),
    getProjectBudget(id),
    getProjectExpenses(id),
    getFundingShareRules(),
    getCompanyProfile(),
    getConfirmState(id),
  ])
  const p = proj.rows[0]
  // ⚠ 「연구비 계상」(비목·한도)은 국가 R&D 전용이다 — 지원사업 건에는 탭 자체가 없다
  //   (`components/project-tabs.tsx`). 이 개요 카드들도 그 탭을 전제로 하니 같이 가른다.
  const 과제사업 = p?.사업유형 === "NATIONAL_RND"

  // 재원 구성(지원금·자부담금)은 R&D 전용이 아니다 — 정부지원금 대 기관부담(현금·현물)의
  // 비율은 지자체·TP 지원사업에도 있는 개념이다. 공고·규정으로 자동 계산하는 로직
  // (`lib/funding-share.ts`)도 사업유형을 안 가린다. 그래서 두 유형 다 여기서 보여주고 고친다
  // (2026-09-04 사용자 지시 — "지원금 및 자부담금 내역이 들어가면 좋겠고, 잘못 기입되면
  // 수정할 수 있게"). 5비목 계상·한도검증(연구비 계상 탭)만 R&D 전용으로 남아 있다.
  const 기관유형 = company.rows[0]?.기업규모 ?? null
  const 공고_id = (p as { 공고_id?: number | null } | undefined)?.공고_id ?? null
  const rule = pickRule(rules.rows, { 공고_id, 사업유형: p?.사업유형 ?? null, 기관유형 })
  const 자동 = computeShare(p?.총사업비 ?? null, rule)
  const 없는이유 =
    자동 != null
      ? null
      : rules.error
        ? `재원 분담 규칙을 읽지 못했다: ${rules.error}`
        : 기관유형 == null
          ? "회사 프로필에 기업규모가 없어 어느 기관유형 규정을 적용할지 정할 수 없다. 회사 프로필을 먼저 채운다."
          : rule == null
            ? `${기관유형} 에 적용할 재원 분담 규칙이 없다.`
            : "총사업비가 비어 있어 재원을 나눌 수 없다. 아래에서 바로 넣는다."

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
      {company.error && <DbError what="회사 프로필" error={company.error} />}
      {confirm.error && <DbError what="계상 확정 상태" error={confirm.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="협약 총사업비" value={won(p?.총사업비)} sub={`정부지원금 ${won(p?.정부지원금)}`} />
        {과제사업 && (
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
        )}
        <Stat label="집행액" value={won(집행)} sub={`소진율 ${소진율}%`} />
        {과제사업 && (
          <Stat
            label="한도 위반"
            value={요약.위반}
            sub={요약.미판정 > 0 ? `미판정 ${요약.미판정}건` : "전부 판정함"}
            tone={요약.위반 > 0 ? "danger" : 요약.미판정 > 0 ? "warn" : "default"}
          />
        )}
      </div>

      {/* 한도 검증(연구수당·간접비)은 국가 R&D 전용이다 — 지원사업 건에는 「연구비 계상」
          탭 자체가 없으니(`components/project-tabs.tsx`) 이 카드도 같이 뺀다. 안 그러면
          없앤 탭으로 가는 링크("연구비 계상에서 고치기")가 남아 있는 채로 보인다. */}
      {과제사업 && (
        <Card className="p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[14.3px] font-medium">한도 검증</span>
            {/* 종료된 과제에는 계상으로 가는 길을 두지 않는다 — 탭·대장 링크와 같은 규칙이다.
                지난 계상은 이 화면의 「한도 검증」과 정산 탭 원장에서 그대로 본다. */}
            {p?.상태 !== "종료" && (
              <Link
                href={`/projects/${id}/budget`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                연구비 계상에서 고치기 →
              </Link>
            )}
          </div>
          {checks.length === 0 ? (
            <EmptyState
              title="검증할 계상이 없습니다"
              hint="연구비 계상 탭에서 비목별 배정액을 넣으면 한도를 검산합니다."
            />
          ) : (
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.키} className="flex flex-wrap items-baseline gap-x-2 text-[14.3px]">
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
      )}

      <Card className="p-4">
        <div className="mb-2 text-[14.3px] font-medium">집행 상태</div>
        {exp.rows.length === 0 ? (
          <p className="text-[14.3px] text-muted-foreground">
            집행 건이 없습니다. Slack 채널에 증빙을 올리면 「검토대기」로 쌓입니다.
          </p>
        ) : (
          <ul className="space-y-1 text-[14.3px]">
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

      {/* 지원금(정부지원금) · 자부담금(기관부담 현금·현물) — 공고·규정으로 자동 계산해
          채우고, 공고를 잘못 읽어 값이 틀렸으면 여기서 바로 고쳐 저장한다(2026-09-04
          사용자 지시). R&D 든 지원사업이든 같은 개념·같은 컴포넌트다 — 5비목 계상·한도검증
          (연구비 계상 탭)만 R&D 전용으로 따로 있다. */}
      <FundingShareCard
        과제_id={id}
        총사업비={p?.총사업비 ?? null}
        협약={{
          정부지원금: p?.정부지원금 ?? null,
          기관부담_현금: p?.기관부담_현금 ?? null,
          기관부담_현물: p?.기관부담_현물 ?? null,
        }}
        자동={자동}
        없는이유={없는이유}
        읽기전용={과제사업 && confirm.확정}
      />
    </>
  )
}
