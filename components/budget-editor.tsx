"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveBudgetLines, deleteBudgetLine } from "@/app/actions/budget"
import { verify, summarize, type ContractInfo } from "@/lib/verify"

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
}: {
  과제_id: number
  초기값: Line[]
  협약: ContractInfo
  비목목록: { 코드: string; 이름: string }[]
}) {
  const [lines, setLines] = React.useState<Line[]>(초기값)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()

  // 서버가 새 데이터를 내려주면(저장 후 revalidate) 그걸 진실로 삼는다.
  React.useEffect(() => setLines(초기값), [초기값])

  const checks = verify(lines, 협약)
  const 요약 = summarize(checks)
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
          <span className="text-xs text-muted-foreground">
            통과 {요약.통과} · 위반 {요약.위반}
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
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.키} className="text-[13px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
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
                  <span className="font-medium">{c.이름}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {won(c.현재)}
                    {c.기준 != null ? ` / 기준 ${won(c.기준)}` : ""}
                  </span>
                  {c.차이 != null && c.차이 !== 0 && (
                    <span
                      className={
                        c.차이 > 0 ? "tabular-nums text-destructive" : "tabular-nums text-muted-foreground"
                      }
                    >
                      {c.차이 > 0 ? `${won(c.차이)} 초과` : `${won(-c.차이)} 미달`}
                    </span>
                  )}
                </div>
                <div className="pl-5 text-xs text-muted-foreground">{c.근거}</div>
              </li>
            ))}
          </ul>
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
                  계상된 비목이 없습니다. 아래에서 비목을 골라 추가하세요.
                </TableCell>
              </TableRow>
            ) : (
              lines.map((l, i) => {
                const 잔액 = (Number(l.배정액) || 0) - l.집행액
                return (
                  <TableRow key={`${l.비목_대분류}-${l.재원구분}`} className="h-[42px] text-[13px]">
                    <TableCell className="font-medium">{l.비목명 ?? l.비목_대분류}</TableCell>
                    <TableCell className="text-muted-foreground">{l.재원구분}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step={1000}
                        value={String(l.배정액)}
                        onChange={(e) => 수정(i, { 배정액: Number(e.target.value) || 0 })}
                        className="h-7 text-right text-[13px] tabular-nums"
                        aria-label={`${l.비목명 ?? l.비목_대분류} ${l.재원구분} 배정액`}
                      />
                    </TableCell>
                    <TableCell>
                      {한도있는비목.has(l.비목_대분류) ? (
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
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7 px-2 text-[12px] text-muted-foreground"
                        disabled={pending}
                        onClick={() => 줄삭제(i)}
                      >
                        삭제
                      </Button>
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
    </div>
  )
}
