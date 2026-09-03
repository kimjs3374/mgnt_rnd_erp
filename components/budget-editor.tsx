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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { saveBudgetLines, deleteBudgetLine } from "@/app/actions/budget"
import {
  verify,
  summarize,
  할일들,
  판정하기,
  실제비율,
  한도대상,
  손봐야하나,
  type Check,
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

// 재원은 **현금·현물 둘뿐**이다(db/111, 2026-09-04 사용자 지시).
// 출연금은 정부가 준 **현금**이라 현금에 합쳤다. 협약서의 정부지원금·기관부담은
// 위 「재원 구성」 카드가 따로 다룬다 — 그건 재원구분이 아니라 협약 항목이다.
const 재원목록 = ["현금", "현물"] as const
/** 한도가 걸리는 비목만 한도% 를 받는다. 나머지 칸에 입력란을 두면 없는 규칙이 있는 것처럼 보인다. */
const 한도있는비목 = new Set(["ALLOWANCE", "INDIRECT"])

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR")

/**
 * 「부족·초과」 검증 한 건이 **어느 줄**을 고치면 풀리는지.
 *
 * ⚠ 전부가 한 줄로 안 좁혀진다 — 그게 정직한 사실이다.
 *   · 연구수당·간접비는 비목이 하나(ALLOWANCE·INDIRECT)라 그 비목의 줄(들)로 좁혀진다.
 *   · 출연금·현금·현물은 **여러 비목에 걸친 재원 합계**다. 그 재원의 줄이 여러 개면
 *     「어느 비목 줄을 고칠지」는 사람이 골라야 한다 — 자동으로 아무 줄이나 골라 채우면
 *     그 비목에 그 금액이 왜 들어갔는지 근거가 없는 채로 숫자만 맞아 보이게 된다
 *     (CLAUDE.md §6-1 「핵심은 판정이 아니라 기록이다」와 정면으로 부딪힌다).
 *   · 총사업비는 재원 세 갈래의 합이라 그 자체로는 고칠 줄이 없다 — 재원을 맞추면 따라 맞는다.
 */
function 자동채우기_후보(c: Check, lines: Line[], 인건비자동: boolean): Line[] {
  const 비목 = c.대상 === "연구수당" ? "ALLOWANCE" : c.대상 === "간접비" ? "INDIRECT" : null
  const 재원 = (재원목록 as readonly string[]).includes(c.대상) ? c.대상 : null
  const 후보 = 비목
    ? lines.filter((l) => l.비목_대분류 === 비목)
    : 재원
      ? lines.filter((l) => l.재원구분 === 재원)
      : []
  // 인건비자동 이면 PERSONNEL 줄은 개인별 표에서만 고친다 — 여기서 건드리면 다음 저장에 덮인다.
  return 인건비자동 ? 후보.filter((l) => l.비목_대분류 !== "PERSONNEL") : 후보
}

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
   * 숨기면 「무엇으로 확정했는지」를 못 본다. 확정 뒤에는 이 탭이 읽기 전용이 되고
   * 다음 일은 집행·정산이다(`db/100`). 「사업 대장으로 넘어간다」고 적지 않는다 —
   * 사이드바가 갈린 뒤 그 이름은 지원사업 쪽 화면을 가리킨다(2026-09-04 정정).
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

  // ⑤ 줄 색칠 — **판정 규칙이 있는 줄만 칠한다**(2026-09-04 사용자 지시).
  //    규칙 없는 비목을 초록으로 칠하면 「검산했다」는 거짓 신호가 된다(설계원칙 5).
  //    ⚠ `TableRow` 기본 클래스에 `hover:bg-muted/50` 이 있고 cn(tailwind-merge)을 거치므로
  //       `hover:` 도 같이 줘야 마우스를 올렸을 때 색이 사라지지 않는다(대장에서 겪었다).
  const 초록 = "bg-green-100 hover:bg-green-200 dark:bg-green-950 dark:hover:bg-green-900"
  const 빨강 = "bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900"

  /** 그 비목에 걸리는 한도 검사. 없으면 null — 한도 규칙이 없는 비목이다. */
  const 줄검사 = (l: Line) => {
    const 대상 = 한도대상(l.비목_대분류)
    return 대상 ? (checks.find((c) => c.대상 === 대상) ?? null) : null
  }

  const 줄색 = (l: Line) => {
    const c = 줄검사(l)
    if (c) {
      const p = 판정하기(c)
      if (p === "초과") return 빨강
      if (p === "맞음" || p === "여유") return 초록
      return "" // 확인필요 — 판정 못 했으면 칠하지 않는다
    }
    // 한도 규칙이 없는 비목이라도 **집행이 배정을 넘긴 것**은 규칙 없이도 사실이다.
    return (Number(l.배정액) || 0) - l.집행액 < 0 ? 빨강 : ""
  }

  /**
   * Ⓑ 그 줄에 넣을 수 있는 **최대 금액**. 한도가 없는 비목은 null(제한하지 않는다).
   *
   * 한도는 비목 **합계**에 걸린다(현금+현물). 그래서 이 줄의 상한은
   * `한도 − 같은 비목 다른 줄의 합` 이다. 음수면 0 — 다른 줄이 이미 한도를 다 썼다는 뜻이다.
   *
   * ⚠ 한도%가 비어 있으면 null 이다. 판정 근거가 없는데 자르면 그게 더 나쁜 거짓말이다.
   * ⚠ 간접비 한도는 자기 자신을 뺀 기준액에서 역산되므로(`lib/verify.ts`) 이 줄 값이
   *   바뀌어도 상한이 흔들리지 않는다 — 그래서 이 계산이 안정적이다.
   */
  const 한도상한 = (i: number): number | null => {
    const l = lines[i]
    const 대상 = 한도대상(l.비목_대분류)
    if (!대상) return null
    const c = checks.find((x) => x.대상 === 대상)
    if (!c || c.기준 == null) return null
    const 다른줄 = lines
      .filter((x, j) => j !== i && x.비목_대분류 === l.비목_대분류)
      .reduce((sum, x) => sum + (Number(x.배정액) || 0), 0)
    return Math.max(0, Number(c.기준) - 다른줄)
  }

  /**
   * 배정액을 넣을 때 한도를 넘기면 **그 자리에서 상한으로 맞추고 이유를 말한다.**
   * 조용히 자르면 사람이 넣은 값이 왜 달라졌는지 모른다(설계원칙 1 — 기록이 핵심이다).
   */
  const 배정액수정 = (i: number, n: number) => {
    const 상한 = 한도상한(i)
    if (상한 != null && n > 상한) {
      const l = lines[i]
      setMsg({
        ok: false,
        text:
          `${l.비목명 ?? l.비목_대분류}은(는) 한도 ${won(상한)} 까지만 넣을 수 있습니다 — ` +
          `입력한 ${won(n)} 은 한도[%]를 넘습니다. 더 잡아야 하면 한도[%] 칸을 먼저 고치세요.`,
      })
      수정(i, { 배정액: 상한 })
      return
    }
    수정(i, { 배정액: n })
  }

  /** 합계 줄 — 협약 총사업비와 맞는지. 협약액이 없으면 칠하지 않는다. */
  const 합계색 = (() => {
    const c = checks.find((x) => x.키 === "총액")
    if (!c || c.통과 == null) return ""
    return c.통과 ? 초록 : 빨강
  })()
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
                {할일.map((t) => {
                  // 같은 이름의 check 를 찾아 자동 채우기의 근거(차이·후보 줄)로 쓴다.
                  // 대상 값이 checks 안에서 유일해서 find 한 번으로 정확히 짚인다.
                  const c = checks.find((x) => x.대상 === t.대상)
                  return (
                    <li
                      key={`${t.대상}-${t.판정}`}
                      className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-[var(--warning-fg)]"
                    >
                      <span className="font-medium">{t.말}</span>
                      {t.금액 > 0 && (
                        <span className="text-[15px] font-semibold tabular-nums">
                          {t.판정 === "부족" ? "+" : "−"}
                          {won(t.금액)}
                        </span>
                      )}
                      {!읽기전용 && c && (t.판정 === "부족" || t.판정 === "초과") && (
                        <CheckAutoFix
                          check={c}
                          lines={lines}
                          인건비자동={인건비자동}
                          // Ⓐ 예전에는 저장 안 한 변경이 있으면 잠갔다 — 값을 한 번 고치면
                          //    못 쓰는 버튼이라 「먼저 저장」을 강요했다. 이제 **화면 값에 반영**하고
                          //    저장은 아래 [계상 저장]에서 한 번에 한다(DB 를 몰래 고치지 않는다).
                          onApply={(비목, 재원, 새값) => {
                            const j = lines.findIndex(
                              (x) => x.비목_대분류 === 비목 && x.재원구분 === 재원,
                            )
                            if (j < 0) return
                            배정액수정(j, 새값)
                          }}
                          onApplied={setMsg}
                          className="ml-auto"
                        />
                      )}
                    </li>
                  )
                })}
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
              {/* 단위를 대괄호로 구분한다(사용자 지시) — 숫자 칸의 머리글은 단위가 붙어야
                  「20」이 20% 인지 20원인지 헷갈리지 않는다. 아래 칸에는 입력값의 실제 비율도 같이 찍는다. */}
              <TableHead className="w-[132px] text-right">한도[%]</TableHead>
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
                  <TableRow
                    key={`${l.비목_대분류}-${l.재원구분}`}
                    className={`h-[42px] text-[13px] ${줄색(l)}`}
                  >
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
                          // Ⓑ 한도가 걸리는 비목은 상한을 넘겨 넣을 수 없다(넘기면 상한으로 맞추고 말해 준다).
                          onValueChange={(n) => 배정액수정(i, n)}
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
                      {/* ④ 한도가 걸리는 비목에는 **지금 입력값이 몇 %인지** 같이 찍는다.
                          한도만 보이면 「20% 이내」인지 사람이 계산해야 한다.
                          비율은 `lib/verify.ts` 의 `실제비율()` — 한도 금액과 같은 공식에서 뽑는다.
                          기준액이 0 이면 「—」다. 0% 라고 적지 않는다(모르면 모른다고 한다). */}
                      {한도대상(l.비목_대분류) &&
                        (() => {
                          const 비율 = 실제비율(lines, 한도대상(l.비목_대분류)!)
                          const c = 줄검사(l)
                          const 넘음 = c ? 판정하기(c) === "초과" : false
                          const 상한 = 한도상한(i)
                          return (
                            <span
                              className={`mt-0.5 block text-right text-[11px] tabular-nums ${
                                넘음 ? "font-medium text-destructive" : "text-muted-foreground"
                              }`}
                              title={
                                한도대상(l.비목_대분류) === "연구수당"
                                  ? "연구수당 ÷ 수정인건비(인건비 + 학생인건비)"
                                  : "간접비 총액 역산 — 100 × 간접비 ÷ (직접비 − 현물 − 간접비)"
                              }
                            >
                              입력 {비율 == null ? "—" : `${비율}%`}
                            </span>
                          )
                        })()}
                      {/* Ⓐ 고칠 줄은 표에 있는데 손이 위쪽 목록에만 있었다. 초과한 줄에서 바로 누른다.
                          이미 저장돼 있던 초과(예: P01 연구수당)를 한 번에 맞추는 자리다. */}
                      {!읽기전용 &&
                        (() => {
                          const c = 줄검사(l)
                          const 상한 = 한도상한(i)
                          if (!c || 판정하기(c) !== "초과" || 상한 == null) return null
                          if ((Number(l.배정액) || 0) <= 상한) return null
                          return (
                            <button
                              type="button"
                              className="mt-1 block w-full rounded-md border border-destructive/40 px-1 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
                              onClick={() => 배정액수정(i, 상한)}
                              title={`${won(Number(l.배정액) || 0)} → ${won(상한)} 로 맞춥니다(저장은 따로 누릅니다)`}
                            >
                              한도까지
                            </button>
                          )
                        })()}
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
            {/* 합계 줄은 협약 총사업비와 맞는지로 칠한다. 협약액이 없으면 칠하지 않는다. */}
            <TableRow
              className={`h-[38px] text-[13px] font-medium ${
                합계색 || "bg-secondary/40 hover:bg-secondary/40"
              }`}
            >
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

/**
 * 「차액 채우기」 — 부족·초과 검증 한 건을 특정 줄의 배정액으로 메운다.
 *
 * 절대 조용히 넣지 않는다 — 버튼을 누르면 **무엇을 얼마로 바꿀지 안내창에서 먼저 보여주고**,
 * 사람이 [적용] 을 눌러야 값이 들어간다. 계산은 코드가 하고 확정은 사람이 한다(설계원칙 3).
 *
 * ⚠ 2026-09-04: **DB 에 바로 저장하지 않고 표의 값으로 넣는다.** 예전에는 곧바로 저장해서,
 *   저장 안 한 변경이 있으면 그걸 덮어쓸 위험 때문에 버튼을 잠가야 했다 —
 *   값을 한 번 고치면 못 쓰는 버튼이었다. 이제 잠글 이유가 없다.
 *
 * ⚠ 컴포넌트 이름을 한글로 짓지 않는다 — JSX 태그 판정이 소문자 ASCII 기준이라 위험하다.
 */
function CheckAutoFix({
  check,
  lines,
  인건비자동,
  onApply,
  onApplied,
  className = "",
}: {
  check: Check
  lines: Line[]
  인건비자동: boolean
  /** 고른 줄의 배정액을 이 값으로 바꿔 달라고 부모에게 알린다(부모가 한도 상한도 같이 본다). */
  onApply: (비목_대분류: string, 재원구분: string, 새값: number) => void
  onApplied: (msg: { ok: boolean; text: string }) => void
  className?: string
}) {
  const [열림, set열림] = React.useState(false)
  const [선택, set선택] = React.useState(0)

  const 후보 = React.useMemo(
    () => 자동채우기_후보(check, lines, 인건비자동),
    [check, lines, 인건비자동],
  )

  if (후보.length === 0) {
    // 고칠 줄이 아예 없다 — 눌러도 할 게 없는 버튼을 보여주지 않는다.
    return check.차이 == null ? null : (
      <span className={"text-[11.5px] font-normal text-[var(--warning-fg)]/80 " + className}>
        먼저 비목을 추가해야 채울 수 있습니다
      </span>
    )
  }

  const 대상줄 = 후보[선택] ?? 후보[0]
  const 차이 = check.차이 ?? 0
  const 새값 = Math.max(0, Math.round(Number(대상줄.배정액) - 차이))
  const 미해결 = Number(대상줄.배정액) - 차이 < 0 ? Math.abs(Number(대상줄.배정액) - 차이) : 0

  function 열기() {
    set선택(0)
    set열림(true)
  }

  function 적용() {
    onApply(대상줄.비목_대분류, 대상줄.재원구분, 새값)
    set열림(false)
    onApplied({
      ok: true,
      text:
        `${대상줄.비목명 ?? 대상줄.비목_대분류} · ${대상줄.재원구분} 배정액을 ${won(새값)} 로 넣었습니다 — ` +
        `아직 저장 전입니다. 아래 [계상 저장]을 누르세요.`,
    })
  }

  return (
    <>
      <button
        type="button"
        className={
          "rounded-md border border-[var(--warning-fg)]/40 px-2 py-0.5 text-[11.5px] font-normal " +
          "text-[var(--warning-fg)] hover:bg-[var(--warning-fg)]/10 disabled:opacity-50 " +
          className
        }
        title="차액만큼 배정액을 맞춰 표에 넣습니다(저장은 따로 누릅니다)"
        onClick={열기}
      >
        차액 채우기
      </button>

      <Dialog open={열림} onOpenChange={(o) => !o && set열림(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{check.이름} — 차액 채우기</DialogTitle>
            <DialogDescription>{check.근거}</DialogDescription>
          </DialogHeader>

          {후보.length > 1 && (
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              어느 줄에 채울까요 — {후보.length}개 중 하나를 고르세요
              <select
                className="h-8 rounded-md border bg-background px-2 text-[13px]"
                value={선택}
                onChange={(e) => set선택(Number(e.target.value))}
              >
                {후보.map((l, i) => (
                  <option key={`${l.비목_대분류}-${l.재원구분}`} value={i}>
                    {l.비목명 ?? l.비목_대분류} · {l.재원구분} (현재 {won(l.배정액)})
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="text-[13.5px]">
            <b>
              {대상줄.비목명 ?? 대상줄.비목_대분류} · {대상줄.재원구분}
            </b>{" "}
            배정액을 {won(대상줄.배정액)} → <b>{won(새값)}</b> 로 바꿉니다 ({차이 > 0 ? "−" : "+"}
            {won(Math.abs(차이))}).
          </p>

          {미해결 > 0 && (
            <p className="text-[12px] text-[var(--warning-fg)]">
              이 줄만으로는 다 못 줄입니다 — {won(미해결)}이 남습니다(0원 아래로는 못 내려갑니다).
              남는 만큼은 다른 줄에서 마저 줄이세요.
            </p>
          )}
          {대상줄.집행액 > 새값 && (
            <p className="text-[12px] text-destructive">
              이미 {won(대상줄.집행액)} 집행됐습니다 — 그보다 적게 배정하면 잔액이 음수가 됩니다.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-7 text-[12.8px]"
              onClick={() => set열림(false)}
            >
              취소
            </Button>
            <Button type="button" className="ml-auto h-7 text-[12.8px]" onClick={적용}>
              적용하고 표에 넣기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
