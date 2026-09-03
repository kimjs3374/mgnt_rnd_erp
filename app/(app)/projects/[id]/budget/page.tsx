import { DbError } from "@/components/db-error"
import { BudgetEditor, type Line } from "@/components/budget-editor"
import { getProject, getProjectBudget, getCategories } from "@/lib/queries-project"

export const dynamic = "force-dynamic"

/**
 * 연구비 계상 — 과제 하나의 비목별 배정액을 넣고 한도를 검산한다.
 *
 * 이 탭이 「예산」 전역 화면과 다른 점은 **쓸 수 있다**는 것이다.
 * 계상은 과제 단위로만 뜻이 있다 — 12개 과제의 인건비를 합친 숫자로는
 * 연구수당 한도도 간접비 역산도 계산되지 않는다. 기준이 과제마다 다르기 때문이다.
 */
export default async function ProjectBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)

  const [proj, budget, cats] = await Promise.all([
    getProject(id),
    getProjectBudget(id),
    getCategories(),
  ])
  const p = proj.rows[0]

  const 정렬 = new Map(cats.rows.map((c) => [c.코드, c.정렬 ?? 999]))
  const lines: Line[] = budget.rows
    .map((b) => ({
      비목_대분류: b.비목_대분류,
      비목명: b.비목명,
      재원구분: b.재원구분,
      배정액: Number(b.배정액 ?? 0),
      한도비율: b.한도비율 == null ? null : Number(b.한도비율),
      집행액: Number(b.집행액 ?? 0),
      기존: true,
    }))
    // 규정 순서로 고정한다. DB 입력순에 맡기면 화면마다 순서가 달라진다.
    .sort(
      (a, b) =>
        (정렬.get(a.비목_대분류) ?? 999) - (정렬.get(b.비목_대분류) ?? 999) ||
        a.재원구분.localeCompare(b.재원구분, "ko"),
    )

  return (
    <>
      {proj.error && <DbError what="과제" error={proj.error} />}
      {budget.error && <DbError what="예산" error={budget.error} />}
      {cats.error && <DbError what="비목" error={cats.error} />}

      <BudgetEditor
        과제_id={id}
        초기값={lines}
        협약={{
          총사업비: p?.총사업비 ?? null,
          정부지원금: p?.정부지원금 ?? null,
          기관부담_현금: p?.기관부담_현금 ?? null,
          기관부담_현물: p?.기관부담_현물 ?? null,
        }}
        비목목록={cats.rows.map((c) => ({ 코드: c.코드, 이름: c.이름 }))}
      />

      <p className="text-xs text-muted-foreground">
        연구수당은 수정인건비 × 한도%(백원 절사), 간접비는 곱셈이 아니라
        (직접비 − 현물) × r/(100+r) 총액 역산(백만원 절사)이다. 한도%가 비어 있으면 판정하지 않고
        「확인 필요」로 둔다 — 연구수당 비율이 사업마다 달라서 코드에 박지 않았다.
      </p>
    </>
  )
}
