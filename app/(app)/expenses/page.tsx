import { PageShell, Card } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExpenseTable, type Row } from "@/components/expense-table"
import { db, safeSelect } from "@/lib/db"
import { getLabels } from "@/lib/labels"
import { won } from "@/lib/queries"
import { getCurrentUser } from "@/lib/current-user"

export const dynamic = "force-dynamic"

/** 급여 정보라 일반회원에게 개인 단위로 안 연다(2026-09-04 사용자 지시) — 합계만 보여준다. */
const 인건비비목 = ["PERSONNEL", "STUDENT"]

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
 * 집행 ★ — 우선순위에서 끝까지 지키는 화면.
 * 행을 누르면 상세가 열리고, 거기서 [이대로 확정] 또는 [비목 수정] 을 한다.
 *
 * ⚠ 권한(2026-09-04) — 인건비·학생인건비 건은 개인 급여와 직결돼 일반회원에게 행 자체를
 *   숨긴다. 합계 숫자만 별도로 보여준다(과제별 집행 탭과 같은 원칙).
 */
export default async function ExpensesPage() {
  const [exp, dec, labels, catRes, subRes, who] = await Promise.all([
    safeSelect<ExpenseRaw>("expenses", () =>
      db.from("expenses").select("*").order("일자", { ascending: false }).limit(200),
    ),
    safeSelect<DecisionRaw>("decisions", () =>
      db.from("decisions").select("*").order("created_at"),
    ),
    getLabels(),
    safeSelect<{ 코드: string; 이름: string; 정렬: number | null }>("categories", () =>
      db.from("categories").select("*"),
    ),
    safeSelect<{ 코드: string; 대분류: string; 이름: string }>("sub_categories", () =>
      db.from("sub_categories").select("*"),
    ),
    getCurrentUser(),
  ])

  const 관리자이상 = who.role === "admin" || who.role === "super_admin"

  const 결정 = new Map<number, DecisionRaw[]>()
  for (const d of dec.rows) {
    const list = 결정.get(d.expense_id) ?? []
    list.push(d)
    결정.set(d.expense_id, list)
  }

  // 「우리 회사 과거 처리」 — 확정된 건 중에서 같은 거래처 또는 같은 세부항목을 고른다.
  // 전건이 200 이하라 한 번 받아 메모리에서 맞춘다. N+1 을 만들지 않는다.
  const 확정건 = exp.rows.filter(
    (e) => ["확정", "제출", "정산완료"].includes(e.상태) && e.비목_세부항목,
  )

  const rows: Row[] = exp.rows.map((e) => {
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
      재원구분: (e.재원구분 as string) ?? "출연금",
      연차: e.연차 == null ? null : Number(e.연차),
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

  const 인건비집행액 = exp.rows
    .filter(
      (e) =>
        ["확정", "제출", "정산완료"].includes(e.상태) &&
        인건비비목.includes((e.비목_대분류 as string) ?? ""),
    )
    .reduce((s, e) => s + Number(e.합계 ?? 0), 0)
  const 표시행 = 관리자이상 ? rows : rows.filter((r) => !인건비비목.includes(r.비목_대분류 ?? ""))

  const cats = catRes.rows
    .sort((a, b) => (a.정렬 ?? 99) - (b.정렬 ?? 99))
    .map((c) => ({ 코드: c.코드, 이름: c.이름 }))

  const 검토대기 = 표시행.filter((r) => r.상태 === "검토대기").length

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
          <span className="ml-auto text-xs text-muted-foreground">
            검토 대기 {검토대기}건
          </span>
        </>
      }
    >
      {exp.error && <DbError what="집행 내역" error={exp.error} />}
      {dec.error && <DbError what="판단 이력" error={dec.error} />}

      {!관리자이상 && (
        <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          인건비 집행 합계: <span className="font-medium text-foreground">{won(인건비집행액)}</span>
          {" "}— 개인별 인건비 집행 건은 관리자 이상만 볼 수 있습니다(아래 목록에서 제외됨).
        </p>
      )}

      <Card>
        <ExpenseTable
          rows={표시행}
          cats={cats}
          subs={subRes.rows}
          labels={labels}
          actor="magnatech"
        />
      </Card>

      <p className="text-xs text-muted-foreground">
        행을 누르면 판단 근거와 과거 처리가 보인다. 확신도 70% 미만은 코드가 자동 확정을 막고,
        정정할 때는 사유를 DB 가 강제한다.
      </p>
    </PageShell>
  )
}
