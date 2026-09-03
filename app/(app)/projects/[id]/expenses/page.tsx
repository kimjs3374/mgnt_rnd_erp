import Link from "next/link"
import { Card, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { ExpenseTable, type Row } from "@/components/expense-table"
import { db, safeSelect } from "@/lib/db"
import { getLabels } from "@/lib/labels"
import { getProjectBudget, getCategories } from "@/lib/queries-project"
import { won } from "@/lib/queries"

export const dynamic = "force-dynamic"

/** 집행으로 인정하는 상태. 「검토대기」와 「반려」는 돈이 나간 것으로 세지 않는다. */
const 집행인정 = ["확정", "제출", "정산완료"]

/** 품목 jsonb 에서 사람이 읽을 이름을 뽑는다. 형태가 흔들려도 화면이 안 죽게. */
function itemLabel(품목: unknown): string {
  if (Array.isArray(품목)) {
    const names = 품목
      .map((i) => {
        if (!i || typeof i !== "object") return null
        const o = i as Record<string, unknown>
        return o.품목명 ?? o.name ?? o.item_name ?? null
      })
      .filter(Boolean)
      .map(String)
    if (names.length) return names.join(", ")
  }
  return "—"
}

type ExpenseRaw = Record<string, unknown> & { id: number; 상태: string }
type DecisionRaw = Record<string, unknown> & { id: number; expense_id: number }

/**
 * 과제 집행 ★ — 이 과제에 달린 집행 건만 본다.
 *
 * ⚠ 「우리 회사 과거 처리」는 **과제를 넘어서 찾는다.** 목록은 이 과제로 좁히지만,
 *   같은 거래처·같은 세부항목을 어떻게 갈랐는지는 다른 과제의 확정 건에도 들어 있다.
 *   그게 이 제품의 주장(쌓이면 좋아진다)이라 여기서 좁히면 안 된다.
 */
export default async function ProjectExpensesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)

  const [all, dec, labels, cats, subRes, budget] = await Promise.all([
    safeSelect<ExpenseRaw>("expenses", () =>
      db.from("expenses").select("*").order("일자", { ascending: false }).limit(500),
    ),
    safeSelect<DecisionRaw>("decisions", () =>
      db.from("decisions").select("*").order("created_at"),
    ),
    getLabels(),
    getCategories(),
    safeSelect<{ 코드: string; 대분류: string; 이름: string }>("sub_categories", () =>
      db.from("sub_categories").select("*"),
    ),
    getProjectBudget(id),
  ])

  const 결정 = new Map<number, DecisionRaw[]>()
  for (const d of dec.rows) {
    const list = 결정.get(d.expense_id) ?? []
    list.push(d)
    결정.set(d.expense_id, list)
  }

  // 과거 처리는 전 과제에서 찾는다(위 주석 참고). 목록만 이 과제로 좁힌다.
  const 확정건 = all.rows.filter(
    (e) => 집행인정.includes(e.상태) && e.비목_세부항목,
  )
  const 이과제 = all.rows.filter((e) => Number(e.과제_id) === id)

  const rows: Row[] = 이과제.map((e) => {
    const 유사 = 확정건
      .filter(
        (o) =>
          o.id !== e.id &&
          (o.거래처 === e.거래처 || o.비목_세부항목 === e.비목_세부항목),
      )
      .slice(0, 3)
      .map((o) => {
        const d = (결정.get(o.id) ?? []).filter((x) => x.정정여부).at(-1)
        return {
          품목: itemLabel(o.품목),
          세부항목: (o.비목_세부항목 as string) ?? null,
          일자: (o.일자 as string) ?? null,
          정정사유: (d?.정정사유 as string) ?? null,
        }
      })

    return {
      id: e.id,
      일자: (e.일자 as string) ?? null,
      거래처: (e.거래처 as string) ?? null,
      품목요약: itemLabel(e.품목),
      합계: e.합계 == null ? null : Number(e.합계),
      공급가액: e.공급가액 == null ? null : Number(e.공급가액),
      세액: e.세액 == null ? null : Number(e.세액),
      비목_대분류: (e.비목_대분류 as string) ?? null,
      비목_세부항목: (e.비목_세부항목 as string) ?? null,
      ai_확신도: e.ai_확신도 == null ? null : Number(e.ai_확신도),
      ai_근거: (e.ai_근거 as string) ?? null,
      방향검증: (e.방향검증 as string) ?? null,
      불일치: e.불일치 ?? null,
      상태: e.상태,
      결정이력: (결정.get(e.id) ?? []).map((d) => ({
        id: d.id,
        확정_비목: d.확정_비목 as string,
        확정_세부항목: (d.확정_세부항목 as string) ?? null,
        정정여부: Boolean(d.정정여부),
        정정사유_유형: (d.정정사유_유형 as string) ?? null,
        정정사유: (d.정정사유 as string) ?? null,
        확정자: (d.확정자 as string) ?? null,
        created_at: String(d.created_at),
      })),
      유사,
    }
  })

  const 검토대기 = rows.filter((r) => r.상태 === "검토대기").length
  const 집행액 = 이과제
    .filter((e) => 집행인정.includes(e.상태))
    .reduce((s, e) => s + Number(e.합계 ?? 0), 0)
  const 배정 = budget.rows.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 미배정 = all.rows.filter((e) => e.과제_id == null).length

  return (
    <>
      {all.error && <DbError what="집행 내역" error={all.error} />}
      {dec.error && <DbError what="판단 이력" error={dec.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="집행 건" value={rows.length} sub={`검토 대기 ${검토대기}건`} />
        <Stat label="집행액" value={won(집행액)} sub="확정·제출·정산완료" />
        <Stat
          label="계상 대비"
          value={배정 > 0 ? `${Math.round((집행액 / 배정) * 1000) / 10}%` : "—"}
          sub={배정 > 0 ? `배정 ${won(배정)}` : "계상이 아직 없다"}
        />
        <Stat
          label="검토 대기"
          value={검토대기}
          sub={검토대기 > 0 ? "확신도 70% 미만은 자동 확정이 막힌다" : "밀린 건 없음"}
          tone={검토대기 > 0 ? "warn" : "default"}
        />
      </div>

      <Card>
        <ExpenseTable
          rows={rows}
          cats={cats.rows.map((c) => ({ 코드: c.코드, 이름: c.이름 }))}
          subs={subRes.rows}
          labels={labels}
          actor="mgnt2"
        />
      </Card>

      <p className="text-xs text-muted-foreground">
        행을 누르면 판단 근거와 과거 처리가 보인다. 확신도 70% 미만은 코드가 자동 확정을 막고,
        정정할 때는 사유를 DB 가 강제한다.{" "}
        <span className="text-foreground">
          「우리 회사 과거 처리」는 이 과제 안에서만 찾지 않는다
        </span>{" "}
        — 같은 품목을 다른 과제에서 어떻게 갈랐는지가 근거로 더 값어치 있다.
      </p>

      {미배정 > 0 && (
        <p className="text-xs text-[var(--warning-fg)]">
          아직 과제가 정해지지 않은 집행이 {미배정}건 있습니다 —{" "}
          <Link href="/expenses" className="underline underline-offset-2">
            전체 집행에서 과제를 지정하세요
          </Link>
          . Slack 으로 막 들어온 건은 과제가 비어 있을 수 있습니다.
        </p>
      )}
    </>
  )
}
