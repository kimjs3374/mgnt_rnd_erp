"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/money-input"
import { saveContractShare } from "@/app/actions/funding-share"
import { 협약금액_확정 } from "@/app/actions/project-budgeting"
import { compareWithContract, type Share } from "@/lib/funding-share"

/**
 * 재원 구성 — 정부출연금 · 민간부담금(현금 · 현물).
 *
 * **손으로 넣던 세 숫자를 공고·규정에서 계산해 미리 채운다.** 계산은 서버에서
 * `lib/funding-share.ts`(순수 함수)가 하고, 이 컴포넌트는 그 결과를 보여주고 저장한다.
 *
 * 규칙 셋을 지킨다 —
 * ① **협약서가 이미 있으면 협약서가 사실이다.** 그때 계산값은 「규정 상한 점검」으로만 쓰고
 *    덮어쓰기를 기본 동작으로 두지 않는다. 협약 변경 없이 숫자만 바꾸면 정산에서 반려된다.
 * ② **비어 있으면 계산값이 그대로 입력값이 된다** — 그게 「자동 입력」이다.
 * ③ **근거가 「확정」이 아니면 배지를 달고 원문을 보여준다.** 값은 계산하지만 사람이 저장한다
 *    (설계원칙 3 — 프롬프트도 규정도 믿지 않고 코드로 자동 확정을 막는다).
 */

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR")

export type 협약값 = {
  정부지원금: number | null
  기관부담_현금: number | null
  기관부담_현물: number | null
}

export function FundingShareCard({
  과제_id,
  총사업비,
  협약,
  자동,
  없는이유,
  읽기전용 = false,
}: {
  과제_id: number
  총사업비: number | null
  협약: 협약값
  자동: Share | null
  없는이유: string | null
  /** 계상이 확정된 과제 — 숫자와 근거는 그대로 보여주고 저장하는 길만 없앤다(`db/100`). */
  읽기전용?: boolean
}) {
  const 협약비었음 =
    협약.정부지원금 == null && 협약.기관부담_현금 == null && 협약.기관부담_현물 == null

  // 협약이 비어 있으면 계산값으로 채워서 시작한다. 있으면 협약값이 먼저다(위 ①②).
  const 초기 = React.useMemo(
    () => ({
      정부지원금: 협약.정부지원금 ?? 자동?.정부출연금 ?? 0,
      기관부담_현금: 협약.기관부담_현금 ?? 자동?.민간부담_현금 ?? 0,
      기관부담_현물: 협약.기관부담_현물 ?? 자동?.민간부담_현물 ?? 0,
    }),
    [협약.정부지원금, 협약.기관부담_현금, 협약.기관부담_현물, 자동],
  )

  const [값, set값] = React.useState(초기)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [열림, set열림] = React.useState(협약비었음)
  const [pending, start] = React.useTransition()

  // 서버가 새 데이터를 내려주면(저장 후 revalidate) 그걸 진실로 삼는다. BudgetEditor 와 같은 규칙.
  React.useEffect(() => set값(초기), [초기])

  const 합계 = 값.정부지원금 + 값.기관부담_현금 + 값.기관부담_현물
  const 더러움 =
    값.정부지원금 !== 초기.정부지원금 ||
    값.기관부담_현금 !== 초기.기관부담_현금 ||
    값.기관부담_현물 !== 초기.기관부담_현물
  const 합계어긋남 = 총사업비 != null && 총사업비 > 0 && 합계 !== 총사업비

  // 대조는 「지금 화면의 값」이 아니라 「저장된 협약값」과 규정 사이에서 한다.
  const checks = 자동 ? compareWithContract(자동, 협약) : []
  const 위반 = checks.filter((c) => c.통과 === false).length
  const 미판정 = checks.filter((c) => c.통과 === null).length

  function 규정값으로채우기() {
    if (!자동) return
    setMsg(null)
    set값({
      정부지원금: 자동.정부출연금,
      기관부담_현금: 자동.민간부담_현금,
      기관부담_현물: 자동.민간부담_현물,
    })
  }

  function 저장() {
    setMsg(null)
    start(async () => {
      const r = await saveContractShare(과제_id, 값)
      setMsg(
        r.ok
          ? { ok: true, text: "협약 재원 구성을 저장했습니다. 아래 한도 검증 기준이 바뀝니다." }
          : { ok: false, text: r.error ?? "저장하지 못했습니다." },
      )
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="text-[14.3px] font-medium">재원 구성 — 정부출연금 · 민간부담금</span>

        {자동 == null ? (
          <span className="text-xs text-[var(--warning-fg)]">근거 없음 — 확인 필요</span>
        ) : (
          <>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[12.1px] text-muted-foreground">
              {자동.규칙.announcement_id != null ? "공고 규칙" : "규정 기본값"} ·{" "}
              {자동.규칙.기관유형}
            </span>
            <span
              className={
                자동.자동확정
                  ? "rounded bg-secondary px-1.5 py-0.5 text-[12.1px] text-muted-foreground"
                  : "rounded px-1.5 py-0.5 text-[12.1px] text-[var(--warning-fg)]"
              }
            >
              {자동.자동확정 ? "근거 확정" : `근거 ${자동.규칙.상태} — 사람이 확인해야 한다`}
            </span>
            <span className="text-xs text-muted-foreground">
              {위반 > 0 ? `규정 위반 ${위반}` : "규정 범위 안"}
              {미판정 > 0 ? ` · 미입력 ${미판정}` : ""}
            </span>
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          className="ml-auto h-6 px-2 text-[13.2px] text-muted-foreground"
          onClick={() => set열림((v) => !v)}
        >
          {열림 ? "접기" : "펼치기"}
        </Button>
      </div>

      {/* 근거가 없을 때가 가장 중요한 화면이다. 빈 상태를 만들지 않으면 「모른다」를 말할 수 없다. */}
      {자동 == null ? (
        <div className="flex flex-col gap-2">
          <p className="text-[14.3px] text-muted-foreground">
            {없는이유 ??
              "이 과제에 적용할 재원 분담 규칙을 찾지 못했다. 공고 규칙이나 기관유형 규정이 등록되면 자동으로 계산한다."}
          </p>
          {/* 총사업비가 비어서 계산을 못 한 것이면, 예전엔 별도 화면(「과제 계상」)으로
              보냈다. 그 화면을 없앴다(2026-09-04 사용자 지시) — 총사업비를 넣는 일도
              여기서 바로 한다. 서버 액션(`협약금액_확정`)은 그대로다. */}
          {!읽기전용 && (총사업비 == null || 총사업비 <= 0) && (
            <TotalBudgetInline 과제_id={과제_id} />
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["정부출연금", "정부지원금", 자동.정부출연금, "출연금"],
                ["민간부담 현금", "기관부담_현금", 자동.민간부담_현금, "현금"],
                ["민간부담 현물", "기관부담_현물", 자동.민간부담_현물, "현물"],
              ] as const
            ).map(([이름, 키, 규정값, 재원]) => {
              const c = checks.find((x) => x.키 === 재원)
              return (
                <div key={키} className="rounded-md border p-2.5">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[13.8px] text-muted-foreground">{이름}</span>
                    <span
                      className={
                        c?.통과 === false
                          ? "text-[12.1px] text-destructive"
                          : c?.통과 === null
                            ? "text-[12.1px] text-[var(--warning-fg)]"
                            : "text-[12.1px] text-muted-foreground"
                      }
                    >
                      {c?.통과 === false ? "✗ 규정 위반" : c?.통과 === null ? "? 미입력" : "✓"}
                    </span>
                  </div>
                  <MoneyInput
                    value={값[키]}
                    onValueChange={(n) => set값((prev) => ({ ...prev, [키]: n }))}
                    className="h-7 text-right text-[14.3px] tabular-nums"
                    aria-label={`${이름} 금액`}
                  />
                  <div className="mt-1 text-[12.7px] text-muted-foreground">
                    규정 계산 {won(규정값)}
                    {총사업비 ? ` · 총사업비의 ${((규정값 / 총사업비) * 100).toFixed(1)}%` : ""}
                  </div>
                  {c && <div className="text-[12.7px] text-muted-foreground">{c.설명}</div>}
                </div>
              )
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.8px]">
            <span className="text-muted-foreground">
              합계 <span className="tabular-nums">{won(합계)}</span>
              {총사업비 != null ? (
                <>
                  {" / 총사업비 "}
                  <span className="tabular-nums">{won(총사업비)}</span>
                </>
              ) : null}
            </span>
            {합계어긋남 && (
              <span className="text-destructive">
                {합계 > (총사업비 ?? 0)
                  ? `${won(합계 - (총사업비 ?? 0))} 초과 — 협약서는 세 금액의 합이 총사업비다`
                  : `${won((총사업비 ?? 0) - 합계)} 미달 — 협약서는 세 금액의 합이 총사업비다`}
              </span>
            )}
            {협약비었음 && !더러움 && (
              <span className="text-muted-foreground">
                협약 금액이 비어 있어 공고·규정 계산값을 채워 두었다 — 확인하고 저장하면 된다
              </span>
            )}
          </div>

          {열림 && (
            <ul className="mt-3 space-y-1 border-t pt-3 text-[12.7px] text-muted-foreground">
              {자동.근거.map((g, i) => (
                <li key={i}>· {g}</li>
              ))}
            </ul>
          )}

          {읽기전용 ? (
            <p className="mt-3 text-[13.8px] text-muted-foreground">
              계상이 확정되어 재원 구성도 잠겼습니다. 계상 합계가 이 금액에 맞춰져 있어서,
              한쪽만 바꾸면 검증이 어긋납니다.
            </p>
          ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-7 text-[14.1px]"
              disabled={pending}
              onClick={규정값으로채우기}
            >
              공고·규정 값으로 채우기
            </Button>
            <span className="ml-auto" />
            {msg && (
              <span
                className={
                  msg.ok ? "text-[13.8px] text-muted-foreground" : "text-[13.8px] text-destructive"
                }
              >
                {msg.text}
              </span>
            )}
            <Button
              type="button"
              className="h-7 text-[14.1px]"
              disabled={pending || !더러움 || 합계어긋남}
              onClick={저장}
            >
              {pending ? "저장 중…" : "협약 금액으로 저장"}
            </Button>
          </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */

/** 숫자칸 — 사람은 137,000,000 으로 친다. 콤마를 지우고 읽는다. */
function 수(v: string): number | null {
  const s = v.replace(/[,\s]/g, "")
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 총사업비 채우기 — **원래 「과제 계상」 화면에 있던 입력창을 그대로 여기로 옮긴 것**이다
 * (2026-09-04). 계산은 여전히 서버가 한다(`협약금액_확정`, `미리보기: true`) — 화면이
 * 따로 계산하면 저장되는 값과 보여준 값이 갈릴 수 있다. 저장하면 `revalidatePath` 로 이
 * 페이지가 새로 그려지면서 위쪽 재원 카드가 계산값으로 바뀐다.
 */
function TotalBudgetInline({ 과제_id }: { 과제_id: number }) {
  const [금액, set금액] = React.useState("")
  const [pending, start] = React.useTransition()
  const [err, setErr] = React.useState<string | null>(null)
  const [미리보기, set미리보기] = React.useState<{
    근거: string[]
    주의: string[]
    채운값: { 정부지원금: number | null; 기관부담_현금: number | null; 기관부담_현물: number | null }
  } | null>(null)

  const 값 = 수(금액)
  const 낼수있나 = 값 != null && 값 > 0 && !pending

  React.useEffect(() => {
    set미리보기(null)
    setErr(null)
  }, [금액])

  function 계산() {
    if (값 == null) return
    start(async () => {
      const r = await 협약금액_확정({ 과제_id, 총사업비: 값, 미리보기: true })
      if (!r.ok) {
        setErr(r.error ?? "계산하지 못했습니다.")
        return
      }
      set미리보기({
        근거: r.근거 ?? [],
        주의: r.주의 ?? [],
        채운값: r.채운값 ?? { 정부지원금: null, 기관부담_현금: null, 기관부담_현물: null },
      })
    })
  }

  function 저장() {
    if (값 == null) return
    start(async () => {
      const r = await 협약금액_확정({ 과제_id, 총사업비: 값 })
      if (!r.ok) {
        setErr(r.error ?? "저장하지 못했습니다.")
        return
      }
      // 서버 액션이 이 경로를 revalidate 한다 — 새 총사업비·재원으로 카드가 다시 그려진다.
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <label className="flex flex-col gap-1 text-[12.7px] text-muted-foreground">
        <span>
          총사업비 <span className="text-destructive">*</span>{" "}
          <span className="text-[11.6px]">
            원 · 신청서에 적을 금액이든 협약서에 적힌 금액이든, 지금 확정된 금액을 그대로
          </span>
        </span>
        <Input
          className="h-8 max-w-xs text-[14.3px]"
          value={금액}
          onChange={(e) => set금액(e.target.value)}
          placeholder="137,000,000"
        />
      </label>

      {미리보기 && (
        <div className="flex flex-col gap-2 rounded-md border p-2.5">
          <div className="grid grid-cols-3 gap-2 text-[13.8px]">
            <div>
              <div className="text-[12.1px] text-muted-foreground">정부출연금</div>
              <div className="tabular-nums">{won(미리보기.채운값.정부지원금 ?? 0)}</div>
            </div>
            <div>
              <div className="text-[12.1px] text-muted-foreground">민간부담 현금</div>
              <div className="tabular-nums">{won(미리보기.채운값.기관부담_현금 ?? 0)}</div>
            </div>
            <div>
              <div className="text-[12.1px] text-muted-foreground">민간부담 현물</div>
              <div className="tabular-nums">{won(미리보기.채운값.기관부담_현물 ?? 0)}</div>
            </div>
          </div>
          <ul className="flex flex-col gap-0.5">
            {미리보기.근거.map((g, i) => (
              <li key={i} className="text-[12.7px] text-muted-foreground">
                · {g}
              </li>
            ))}
          </ul>
          {미리보기.주의.map((w, i) => (
            <span key={i} className="text-[12.7px] text-[var(--warning-fg)]">
              {w}
            </span>
          ))}
        </div>
      )}

      {err && <span className="text-[13.2px] text-destructive">{err}</span>}

      <div className="flex items-center gap-2">
        <span className="text-[12.1px] text-muted-foreground">
          공고 규정 또는 기관유형 규정 기본값으로 정부출연금·민간부담을 나눠 채운다
        </span>
        <Button
          type="button"
          variant="outline"
          className="ml-auto h-7 text-[14.1px]"
          disabled={!낼수있나}
          onClick={계산}
        >
          {pending && !미리보기 ? "계산 중…" : "규정으로 계산"}
        </Button>
        <Button
          type="button"
          className="h-7 text-[14.1px]"
          disabled={!낼수있나 || !미리보기}
          onClick={저장}
        >
          {pending && 미리보기 ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  )
}
