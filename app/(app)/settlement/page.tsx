import { PageShell, Card, EmptyState } from "@/components/page-shell"

/**
 * 정산 — RCMS 입력 직전 상태를 완성해두는 화면.
 * ⚠ RCMS 는 외부 API 가 없다. 「연동」이라고 쓰지 않는다.
 *    사람이 화면에 옮겨 적어야 하므로, 옮겨 적기 직전 상태를 완벽하게 만들어 둔다.
 */
export default function SettlementPage() {
  return (
    <PageShell
      title="정산"
      description="비목·금액·증빙이 제출 순서대로 정렬된다. 보고 그대로 옮겨 적으면 된다."
    >
      <Card>
        <EmptyState
          title="정산 대기 건이 없습니다"
          hint="집행이 「확정」되면 여기에 제출 순서대로 쌓입니다."
        />
      </Card>

      <div className="rounded-lg border bg-card p-4 text-[13px] text-muted-foreground">
        지자체·TP 사업은 선집행 후 세금계산서·이체증을 제출하고, 국가 R&D 는 RCMS 에 입력한다.
        <span className="text-foreground"> 사업유형에 따라 절차가 갈린다 —</span> 코드에 박지 않고
        데이터로 둔 이유다.
      </div>
    </PageShell>
  )
}
