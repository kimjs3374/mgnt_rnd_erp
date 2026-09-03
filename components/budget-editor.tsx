"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/money-input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveBudgetLines, deleteBudgetLine } from "@/app/actions/budget"
import {
  verify,
  summarize,
  할일들,
  판정하기,
  손봐야하나,
  type ContractInfo,
} from "@/lib/verify"

export type Line = {
  비목_대분류: string
  비목명: string | null
  재원구분: string
  배정액: number
  한도비율: number | null
  집행액: number
  /** DB 에 이미 있는 줄인지. 새로 추가한 줄은 저장 전까지 삭제 버튼이 아니라 그냥 빼면 된다. */
  기존: boolean
}

const 재원목록 = ["출연금", "현금", "현물"] as const
/** 한도가 걸리는 비목만 한도% 를 받는다. 나머지 칸에 입력란을 두면 없는 규칙이 있는 것처럼 보인다. */
const 한도있는비목 = new Set(["ALLOWANCE", "INDIRECT"])

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR")

/**
 * 연구비 계상 편집기.
 *
 * 검증을 **입력하는 즉시** 다시 돌린다. `lib/verify.ts` 가 DB 도 fetch 도 안 타는 순수 함수라
 * 서버와 클라이언트가 같은 코드를 쓴다 — 화면에서 본 판정과 저장 뒤 판정이 어긋날 수 없다.
 * 저장 전에 「이렇게 바꾸면 한도에 걸리나」를 눌러 보는 것이 이 탭의 용도다.
 */
export function BudgetEditor({
  과제_id,
  초기값,
  협약,
  비목목록,
  읽기전용 = false,
  인건비자동 = false,
}: {
  과제_id: number
  초기값: Line[]
  협약: ContractInfo
  비목목록: { 코드: string; 이름: string }[]
  /**
   * 계상이 확정된 과제. **표와 검증 결과는 그대로 보여주고 고치는 길만 없앤다** —
   * 숨기면 「무엇으로 확정했는지」를 못 본다. 확정 뒤 관리 위치는 사업 대장이다(`db/100`).
   */
  읽기전용?: boolean
  /**
   * 개인별 인건비가 한 줄이라도 있는 과제. **인건비 줄을 여기서 못 고치게 한다.**
   *
   * 저장할 때마다 개인별 합계가 이 줄을 덮으므로(`app/actions/personnel.ts`),
   * 열어 두면 손으로 고친 값이 다음 저장에 조용히 사라진다.
   * 막는 것이 아니라 **어디서 고쳐야 하는지 알려주는 것**이다 — 위의 개인별 표에서 고친다.
   */
  인건비자동?: boolean
}) {
  const [lines, setLines] = React.useState<Line[]>(초기값)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()

  // 서버가 새 데이터를 내려주면(저장 후 revalidate) 그걸 진실로 삼는다.
  React.useEffect(() => setLines(초기값), [초기값])

  const checks = verify(lines, 협약)
  const 요약 = summarize(checks)
  const 할일 = 할일들(checks)
  // 손봐야 하는 줄을 위로. 다 통과했으면 순서를 흔들지 않는다(원래 순서가 곧 일하는 순서다).
  const 정렬된 = [...checks].sort((a, b) => Number(손봐야하나(b)) - Number(손봐야하나(a)))
  const 계상합계 = lines.reduce((s, l) => s + (Number(l.배정액) || 0), 0)
  const 집행합계 = lines.reduce((s, l) => s + (Number(l.집행액) || 0), 0)
  const 더러움 = JSON.stringify(lines) !== JSON.stringify(초기값)

  const 수정 = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  // 아직 안 쓴 (비목, 재원) 조합만 고를 수 있게 한다. DB 에 UNIQUE 제약이 걸려 있어
  // 중복을 넣으면 저장할 때 터지는데, 그때 알려주는 것보다 애초에 못 고르게 하는 편이 낫다.
  const 남은조합 = 비목목록.flatMap((c) =>
    재원목록
      .filter((s) => !lines.some((l) => l.비목_대분류 === c.코드 && l.재원구분 === s))
      .map((s) => ({ 코드: c.코드, 이름: c.이름, 재원: s })),
  )
  const [새줄, set새줄] = React.useState("")

  function 추가() {
    const found = 남은조합.find((o) => `${o.코드}|${o.재원}` === 새줄)
    if (!found) return
    setLines((prev) => [
      ...prev,
      {
        비목_대분류: found.코드,
        비목명: found.이름,
        재원구분: found.재원,
        배정액: 0,
        한도비율: null,
        집행액: 0,
        기존: false,
      },
    ])
    set새줄("")
  }

  function 저장() {
    setMsg(null)
    start(async () => {
      const r = await saveBudgetLines(
        과제_id,
        lines.map((l) => ({
          비목_대분류: l.비목_대분류,
          재원구분: l.재원구분,
          배정액: Number(l.배정액) || 0,
          한도비율: l.한도비율 == null ? null : Number(l.한도비율),
        })),
      )
      setMsg(
        r.ok
          ? { ok: true, text: "저장했습니다. 정산 원장의 배정액도 같이 바뀝니다." }
          : { ok: false, text: r.error ?? "저장하지 못했습니다." },
      )
    })
  }

  function 줄삭제(i: number) {
    const l = lines[i]
    if (!l.기존) {
      setLines((prev) => prev.filter((_, j) => j !== i))
      return
    }
    if (l.집행액 > 0) {
      setMsg({
        ok: false,
        text: `${l.비목명 ?? l.비목_대분류} / ${l.재원구분} 은 이미 ${won(l.집행액)} 집행됐습니다. 배정 줄을 지우면 집행이 배정 없는 상태가 됩니다.`,
      })
      return
    }
    setMsg(null)
    start(async () => {
      const r = await deleteBudgetLine(과제_id, l.비목_대분류, l.재원구분)
      if (r.ok) setLines((prev) => prev.filter((_, j) => j !== i))
      else setMsg({ ok: false, text: r.error ?? "지우지 못했습니다." })
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 검증 — 표 위에 둔다. 고치는 동안 계속 보여야 하는 것이라 아래에 두면 안 보인다. */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <span className="text-[13px] font-medium">한도 검증</span>
          {/* 손볼 것이 몇 개인지가 먼저다. 「통과 4」는 그 다음에 알아도 되는 숫자다. */}
          {할일.length > 0 ? (
            <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 text-xs font-medium text-[var(--warning-fg)]">
              손볼 것 {할일.length}
            </span>
          ) : (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              모두 맞음
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            검사 {checks.length}건 · 통과 {요약.통과}
            {요약.위반 > 0 ? ` · 위반 ${요약.위반}` : ""}
            {요약.미판정 > 0 ? ` · 미판정 ${요약.미판정}` : ""}
          </span>
          {더러움 && (
            <span className="text-xs text-[var(--warning-fg)]">
              저장하지 않은 변경이 있습니다 — 아래 판정은 화면의 값 기준입니다
            </span>
          )}
        </div>

        {checks.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            비목별 배정액을 넣으면 한도를 검산합니다.
          </p>
        ) : (
          <>
            {/* ★ 「그래서 뭘 해야 하나」를 맨 위에 한 줄씩 적는다.
                여섯 줄을 읽고 머릿속에서 할 일을 만들게 하지 않는다. */}
            {할일.length > 0 ? (
              <ul className="mb-3 space-y-1 rounded-md border border-[var(--warning-fg)]/30 bg-[var(--warning)] px-3 py-2">
                {할일.map((t) => (
                  <li
                    key={`${t.대상}-${t.판정}`}
                    className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-[var(--warning-fg)]"
                  >
                    <span className="font-medium">{t.말}</span>
                    {t.금액 > 0 && (
                      <span className="ml-auto text-[15px] font-semibold tabular-nums">
                        {t.판정 === "부족" ? "+" : "−"}
                        {won(t.금액)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 rounded-md border bg-secondary/40 px-3 py-2 text-[13px] text-muted-foreground">
                손볼 것이 없습니다 — 계상이 협약 금액과 맞고 한도 안에 있습니다.
              </p>
            )}

            <ul className="space-y-1.5">
              {정렬된.map((c) => {
                const p = 판정하기(c)
                const 문제 = p === "부족" || p === "초과"
                const 배지 =
                  p === "초과"
                    ? "bg-destructive/10 text-destructive"
                    : p === "부족"
                      ? "bg-[var(--warning)] text-[var(--warning-fg)]"
                      : p === "확인필요"
                        ? "bg-[var(--warning)] text-[var(--warning-fg)]"
                        : "bg-secondary text-muted-foreground"
                return (
                  <li
                    key={c.키}
                    className={
                      "rounded-md px-2 py-1.5 text-[13px] " +
                      (문제 || p === "확인필요" ? "bg-secondary/50" : "")
                    }
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {/* 상태를 **말로** 적는다. ✓/✗ 두 가지로는 「한도 안이지만 여유가 있다」를 못 말한다. */}
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${배지}`}>
                        {p === "맞음" ? "맞음" : p}
                      </span>
                      <span className={문제 ? "font-medium" : ""}>{c.이름}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {won(c.현재)}
                        {c.기준 != null ? ` / 기준 ${won(c.기준)}` : ""}
                      </span>
                      {c.차이 != null && c.차이 !== 0 && (
                        <span
                          className={
                            "ml-auto tabular-nums " +
                            (p === "초과"
                              ? "font-semibold text-destructive"
                              : p === "부족"
                                ? "font-semibold text-[var(--warning-fg)]"
                                : "text-muted-foreground")
                          }
                        >
                          {p === "여유"
                            ? `여유 ${won(-c.차이)}`
                            : `${c.차이 > 0 ? "+" : "−"}${won(Math.abs(c.차이))}`}
                        </span>
                      )}
                    </div>
                    <div className="pl-1 text-xs text-muted-foreground">{c.근거}</div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>비목</TableHead>
              <TableHead className="w-[90px]">재원</TableHead>
              <TableHead className="w-[170px] text-right">배정액</TableHead>
              <TableHead className="w-[92px] text-right">한도%</TableHead>
              <TableHead className="text-right">집행액</TableHead>
              <TableHead className="text-right">잔액</TableHead>
              <TableHead className="w-[52px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-[13px] text-muted-foreground">
                  {읽기전용
                    ? "계상된 비목이 없습니다."
                    : "계상된 비목이 없습니다. 아래에서 비목을 골라 추가하세요."}
                </TableCell>
              </TableRow>
            ) : (
              lines.map((l, i) => {
                const 잔액 = (Number(l.배정액) || 0) - l.집행액
                return (
                  <TableRow key={`${l.비목_대분류}-${l.재원구분}`} className="h-[42px] text-[13px]">
                    <TableCell className="font-medium">
                      {l.비목명 ?? l.비목_대분류}
                      {/* 이 줄이 어디서 오는지 줄에서 바로 보여야 한다. 안 적으면 「왜 못 고치지」가 된다. */}
                      {인건비자동 && l.비목_대분류 === "PERSONNEL" && (
                        <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10.5px] font-normal text-muted-foreground">
                          개인별에서 자동
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.재원구분}</TableCell>
                    <TableCell>
                      {읽기전용 || (인건비자동 && l.비목_대분류 === "PERSONNEL") ? (
                        <span className="block text-right tabular-nums">
                          {won(Number(l.배정액) || 0)}
                        </span>
                      ) : (
                        <MoneyInput
                          value={Number(l.배정액) || 0}
                          onValueChange={(n) => 수정(i, { 배정액: n })}
                          className="h-7 text-right text-[13px] tabular-nums"
                          aria-label={`${l.비목명 ?? l.비목_대분류} ${l.재원구분} 배정액`}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {읽기전용 ? (
                        <span className="block text-right tabular-nums text-muted-foreground">
                          {l.한도비율 == null ? "—" : `${l.한도비율}%`}
                        </span>
                      ) : 한도있는비목.has(l.비목_대분류) ? (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={l.한도비율 == null ? "" : String(l.한도비율)}
                          placeholder="—"
                          onChange={(e) =>
                            수정(i, {
                              한도비율: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className="h-7 text-right text-[13px] tabular-nums"
                          aria-label={`${l.비목명 ?? l.비목_대분류} 한도 비율`}
                        />
                      ) : (
                        <span className="block text-right text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {won(l.집행액)}
                    </TableCell>
                    <TableCell
                      className={
                        잔액 < 0
                          ? "text-right font-medium tabular-nums text-destructive"
                          : "text-right tabular-nums"
                      }
                    >
                      {won(잔액)}
                    </TableCell>
                    <TableCell>
                      {!읽기전용 && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 px-2 text-[12px] text-muted-foreground"
                          disabled={pending}
                          onClick={() => 줄삭제(i)}
                        >
                          삭제
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
            <TableRow className="h-[38px] bg-secondary/40 text-[13px] font-medium hover:bg-secondary/40">
              <TableCell colSpan={2}>합계</TableCell>
              <TableCell className="text-right tabular-nums">{won(계상합계)}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{won(집행합계)}</TableCell>
              <TableCell className="text-right tabular-nums">{won(계상합계 - 집행합계)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {읽기전용 ? (
        <p className="text-[12.5px] text-muted-foreground">
          계상이 확정되어 <b>볼 수만 있습니다.</b> 고쳐야 하면 위에서 [확정 해제]를 먼저 하세요 —
          정산 대조 기준이 바뀌는 일이라 사유가 남습니다.
        </p>
      ) : (
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={새줄}
          onChange={(e) => set새줄(e.target.value)}
          className="h-7 rounded-md border bg-transparent px-2 text-[13px]"
          aria-label="추가할 비목과 재원"
        >
          <option value="">비목 · 재원 추가…</option>
          {남은조합.map((o) => (
            <option key={`${o.코드}|${o.재원}`} value={`${o.코드}|${o.재원}`}>
              {o.이름} / {o.재원}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          className="h-7 text-[12.8px]"
          disabled={!새줄}
          onClick={추가}
        >
          + 줄 추가
        </Button>

        <span className="ml-auto" />

        {msg && (
          <span
            className={
              msg.ok ? "text-[13px] text-muted-foreground" : "text-[13px] text-destructive"
            }
          >
            {msg.text}
          </span>
        )}
        <Button
          type="button"
          className="h-7 text-[12.8px]"
          disabled={pending || !더러움}
          onClick={저장}
        >
          {pending ? "저장 중…" : "계상 저장"}
        </Button>
      </div>
      )}
    </div>
  )
}
