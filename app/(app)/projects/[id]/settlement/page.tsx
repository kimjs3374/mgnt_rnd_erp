import { Card, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { won } from "@/lib/queries"
import {
  getProjectBudget,
  getProjectExpenses,
  getCategories,
} from "@/lib/queries-project"

export const dynamic = "force-dynamic"

/** RCMS 에 옮겨 적을 대상. 「검토대기」는 아직 사람이 확정하지 않았고 「반려」는 되돌아온 건이다. */
const 대조대상 = ["확정", "제출"]

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

/**
 * 과제 정산 — 과제비 원장 · 사용 건 · RCMS 입력 대조.
 *
 * ⚠ RCMS 는 외부 API 가 없다. 「연동」이라고 쓰지 않는다.
 *   사람이 RCMS 화면에 옮겨 적기 **직전 상태**를 완성해두는 것이 여기서 하는 일이고,
 *   마지막 입력은 사람이 한다.
 */
export default async function ProjectSettlementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)

  const [budget, exp, cats] = await Promise.all([
    getProjectBudget(id),
    getProjectExpenses(id),
    getCategories(),
  ])

  const 이름 = new Map(cats.rows.map((c) => [c.코드, c.이름]))
  const 정렬 = new Map(cats.rows.map((c) => [c.코드, c.정렬 ?? 999]))

  const 원장 = budget.rows.slice().sort(
    (a, b) =>
      (정렬.get(a.비목_대분류) ?? 999) - (정렬.get(b.비목_대분류) ?? 999) ||
      a.재원구분.localeCompare(b.재원구분, "ko"),
  )
  const 총배정 = 원장.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 총집행 = 원장.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
  const 초과 = 원장.filter((b) => Number(b.잔액 ?? 0) < 0)

  const 대조 = exp.rows
    .filter((e) => 대조대상.includes(e.상태))
    // 제출 순서대로 — 사람이 위에서부터 그대로 옮겨 적는다.
    .sort((a, b) => (a.일자 ?? "").localeCompare(b.일자 ?? ""))

  return (
    <>
      {budget.error && <DbError what="과제비 원장" error={budget.error} />}
      {exp.error && <DbError what="집행" error={exp.error} />}

      <div className="rounded-lg border bg-card p-4 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">RCMS 는 외부 API 가 없습니다.</span>{" "}
        이건 「연동」이 아니라 사람이 RCMS 화면에 옮겨 적기 직전 상태를 완성해두는 것입니다.
        마지막 입력은 사람이 합니다.
      </div>

      {/* ── 과제비 원장 */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
          <span className="text-[13px] font-medium">과제비 원장</span>
          <span className="text-xs text-muted-foreground">
            집행으로 인정하는 상태: 확정 · 제출 · 정산완료
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            배정 {won(총배정)} · 집행 {won(총집행)} ·{" "}
            {총배정 > 0 ? Math.round((총집행 / 총배정) * 1000) / 10 : 0}%
          </span>
        </div>

        {원장.length === 0 ? (
          <EmptyState
            title="계상된 비목이 없습니다"
            hint="「연구비 계상」 탭에서 배정액을 넣으면 원장이 만들어집니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>비목</TableHead>
                <TableHead className="w-[90px]">재원</TableHead>
                <TableHead className="text-right">배정액</TableHead>
                <TableHead className="text-right">집행액</TableHead>
                <TableHead className="text-right">잔액</TableHead>
                <TableHead className="w-[180px]">소진율</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {원장.map((b, i) => {
                const rate = Number(b.소진율 ?? 0)
                const over = Number(b.잔액 ?? 0) < 0
                return (
                  <TableRow
                    key={`${b.비목_대분류}-${b.재원구분}-${i}`}
                    className="h-[38px] text-[13px]"
                  >
                    <TableCell className="font-medium">
                      {b.비목명 ?? 이름.get(b.비목_대분류) ?? b.비목_대분류}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{b.재원구분}</TableCell>
                    <TableCell className="text-right tabular-nums">{won(b.배정액)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {won(Number(b.집행액))}
                    </TableCell>
                    <TableCell
                      className={
                        over
                          ? "text-right font-medium tabular-nums text-destructive"
                          : "text-right tabular-nums"
                      }
                    >
                      {won(Number(b.잔액))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={
                              rate >= 100
                                ? "h-full bg-destructive"
                                : rate >= 85
                                  ? "h-full bg-[var(--warning-fg)]"
                                  : "h-full bg-[var(--chart-2)]"
                            }
                            style={{ width: `${Math.min(rate, 100)}%` }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right tabular-nums text-xs">
                          {rate}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="h-[38px] bg-secondary/40 text-[13px] font-medium hover:bg-secondary/40">
                <TableCell colSpan={2}>합계</TableCell>
                <TableCell className="text-right tabular-nums">{won(총배정)}</TableCell>
                <TableCell className="text-right tabular-nums">{won(총집행)}</TableCell>
                <TableCell className="text-right tabular-nums">{won(총배정 - 총집행)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}

        {초과.length > 0 && (
          <div className="border-t p-3 text-[13px]">
            <span className="font-medium text-destructive">
              배정액 초과 {초과.length}건
            </span>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {초과.map((b, i) => (
                <li key={i}>
                  {b.비목명 ?? b.비목_대분류} / {b.재원구분} —{" "}
                  {won(Math.abs(Number(b.잔액)))} 초과
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── 사용 건 */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
          <span className="text-[13px] font-medium">사용 건</span>
          <span className="text-xs text-muted-foreground">{exp.rows.length}건</span>
        </div>
        {exp.rows.length === 0 ? (
          <EmptyState
            title="집행 건이 없습니다"
            hint="Slack 채널에 증빙을 올리면 봇이 판독해 「검토대기」로 쌓습니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[96px]">일자</TableHead>
                <TableHead>품목 / 거래처</TableHead>
                <TableHead className="w-[200px]">비목</TableHead>
                <TableHead className="w-[80px]">재원</TableHead>
                <TableHead className="text-right">합계</TableHead>
                <TableHead className="w-[92px]">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exp.rows.map((e) => (
                <TableRow key={e.id} className="h-[42px] text-[13px]">
                  <TableCell className="tabular-nums text-muted-foreground">
                    {e.일자 ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div>{itemLabel(e.품목)}</div>
                    <div className="text-xs text-muted-foreground">{e.거래처 ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.비목_대분류 ? (이름.get(e.비목_대분류) ?? e.비목_대분류) : "미분류"}
                    {e.비목_세부항목 && (
                      <div className="text-xs">{e.비목_세부항목}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.재원구분}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(e.합계)}</TableCell>
                  <TableCell>
                    <StatusBadge value={e.상태} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── RCMS 입력 대조 */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
          <span className="text-[13px] font-medium">RCMS 입력 대조</span>
          <span className="text-xs text-muted-foreground">
            제출 순서(일자)대로 정렬했습니다. 위에서부터 그대로 옮겨 적으면 됩니다.
          </span>
        </div>
        {대조.length === 0 ? (
          <EmptyState
            title="옮겨 적을 건이 없습니다"
            hint="집행이 「확정」되면 여기에 제출 순서대로 쌓입니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[44px]">#</TableHead>
                <TableHead className="w-[96px]">일자</TableHead>
                <TableHead className="w-[200px]">비목 / 세부항목</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead className="text-right">공급가액</TableHead>
                <TableHead className="text-right">세액</TableHead>
                <TableHead className="text-right">합계</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {대조.map((e, i) => (
                <TableRow key={e.id} className="h-[38px] text-[13px]">
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="tabular-nums">{e.일자 ?? "—"}</TableCell>
                  <TableCell>
                    {e.비목_대분류 ? (이름.get(e.비목_대분류) ?? e.비목_대분류) : "미분류"}
                    {e.비목_세부항목 && (
                      <div className="text-xs text-muted-foreground">{e.비목_세부항목}</div>
                    )}
                  </TableCell>
                  <TableCell>{itemLabel(e.품목)}</TableCell>
                  <TableCell className="text-muted-foreground">{e.거래처 ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(e.공급가액)}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(e.세액)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {won(e.합계)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="h-[38px] bg-secondary/40 text-[13px] font-medium hover:bg-secondary/40">
                <TableCell colSpan={5}>합계 {대조.length}건</TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(대조.reduce((s, e) => s + Number(e.공급가액 ?? 0), 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(대조.reduce((s, e) => s + Number(e.세액 ?? 0), 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(대조.reduce((s, e) => s + Number(e.합계 ?? 0), 0))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}
