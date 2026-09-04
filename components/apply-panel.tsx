"use client"

import * as React from "react"
import Link from "next/link"
import { Handshake, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/money-input"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import { applyToAnnouncement, setSelectionResult } from "@/app/actions/apply"

/**
 * 공고 상세 아래에 붙는 「지원 → 선정 → 대장」 패널.
 *
 * 대장을 따로 만들지 않는다 — 지원을 등록하면 `app.projects` 에 한 줄이 생기고
 * 그게 곧 지원사업 대장(`v_program_ledger`)의 한 줄이다. 선정되면 상태가 「수행중」이 되어
 * 과제사업 대장에도 뜬다. **공고와 대장을 잇는 게 아니라 처음부터 같은 한 건**이다.
 *
 * 사람이 넣어야 하는 것은 사업기간뿐이다(협약 전이라 총사업비는 0 으로 두고,
 * 선정 뒤 「연구비 계상」 탭의 재원 구성 카드가 공고·규정으로 채운다).
 */

const 배지 = (v: string | null) => <StatusBadge value={v ?? "미등록"} />

export type 지원행 = {
  id: number
  과제명: string
  과제코드: string | null
  선정결과: string | null
  신청일: string | null
  발표심사일: string | null
  선정결과일: string | null
  상태: string
}

export function ApplyPanel({
  공고_id,
  사업명,
  접수종료,
  지원행목록,
}: {
  공고_id: number
  사업명: string | null
  접수종료: string | null
  지원행목록: 지원행[]
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()
  const [폼열림, set폼열림] = React.useState(지원행목록.length === 0)
  const [강제, set강제] = React.useState(false)

  // 사업기간 기본값 — 접수마감 다음 달 1일부터 1년. 어디까지나 예정이라 화면에 그렇게 적는다.
  const 기본시작 = React.useMemo(() => {
    const base = 접수종료 ? new Date(접수종료) : new Date()
    base.setMonth(base.getMonth() + 1, 1)
    return base.toISOString().slice(0, 10)
  }, [접수종료])
  const 기본종료 = React.useMemo(() => {
    const d = new Date(기본시작)
    d.setFullYear(d.getFullYear() + 1)
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  }, [기본시작])

  const [과제명, set과제명] = React.useState(사업명 ?? "")
  const [시작일, set시작일] = React.useState(기본시작)
  const [종료일, set종료일] = React.useState(기본종료)
  const [지원금액, set지원금액] = React.useState(0)

  function 등록() {
    setMsg(null)
    start(async () => {
      const r = await applyToAnnouncement({
        공고_id,
        과제명,
        시작일,
        종료일,
        지원금액: 지원금액 || undefined,
        강제,
      })
      if (r.ok) {
        setMsg({ ok: true, text: "지원을 등록했습니다. 지원사업 대장에 한 줄이 생겼습니다." })
        set폼열림(false)
        set강제(false)
      } else {
        setMsg({ ok: false, text: r.error ?? "등록하지 못했습니다." })
        if (r.기존?.length) set강제(true) // 한 번 더 누르면 강제로 만든다(내역사업이 갈린 경우)
      }
    })
  }

  function 결과(과제_id: number, v: "발표심사" | "선정" | "미선정") {
    setMsg(null)
    start(async () => {
      const r = await setSelectionResult(과제_id, v)
      setMsg(
        r.ok
          ? {
              ok: true,
              text:
                v === "선정"
                  ? "선정으로 기록했습니다. 과제사업 대장에 뜨고, 연구비 계상을 시작할 수 있습니다."
                  : `${v}(으)로 기록했습니다.`,
            }
          : { ok: false, text: r.error ?? "기록하지 못했습니다." },
      )
    })
  }

  const cell = "h-7 text-[13.8px]"

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center self-center rounded-md bg-primary/10 text-primary">
          <Handshake className="size-3.5" />
        </span>
        <span className="text-[14.3px] font-medium">지원 · 선정 · 대장</span>
        <span className="text-xs text-muted-foreground">
          지원을 등록하면 지원사업 대장의 한 줄이 되고, 선정되면 그 줄이 과제가 됩니다
        </span>
        {지원행목록.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[13.2px] text-muted-foreground"
            onClick={() => set폼열림((v) => !v)}
          >
            {폼열림 ? "닫기" : "+ 한 건 더 등록"}
          </Button>
        )}
      </div>

      {지원행목록.length > 0 && (
        <ul className="mb-3 space-y-2">
          {지원행목록.map((p) => (
            <li
              key={p.id}
              className={cn(
                "rounded-md border border-l-4 p-2.5 text-[13.8px]",
                p.선정결과 === "선정"
                  ? "border-l-[var(--success-fg)]"
                  : p.선정결과 === "미선정"
                    ? "border-l-destructive"
                    : "border-l-[var(--warning-fg)]",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/projects/${p.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {p.과제명}
                </Link>
                <span className="text-muted-foreground">{p.과제코드}</span>
                {배지(p.선정결과)}
                <span className="text-muted-foreground">상태 {p.상태}</span>
                <span className="text-muted-foreground tabular-nums">
                  {p.신청일 ? `신청 ${p.신청일}` : ""}
                  {p.발표심사일 ? ` · 심사 ${p.발표심사일}` : ""}
                  {p.선정결과일 ? ` · 결과 ${p.선정결과일}` : ""}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-6 px-2 text-[12.7px]"
                  disabled={pending || p.선정결과 === "발표심사"}
                  onClick={() => 결과(p.id, "발표심사")}
                >
                  발표·심사
                </Button>
                <Button
                  type="button"
                  className="h-6 px-2 text-[12.7px]"
                  disabled={pending || p.선정결과 === "선정"}
                  onClick={() => 결과(p.id, "선정")}
                >
                  선정
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-6 px-2 text-[12.7px]"
                  disabled={pending || p.선정결과 === "미선정"}
                  onClick={() => 결과(p.id, "미선정")}
                >
                  미선정
                </Button>
                <span className="ml-auto flex gap-2 text-[12.7px]">
                  <Link href="/programs" className="text-muted-foreground underline-offset-2 hover:underline">
                    지원사업 대장
                  </Link>
                  {p.선정결과 === "선정" && (
                    <Link
                      href={`/projects/${p.id}/budget`}
                      className="flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
                    >
                      연구비 계상 시작
                      <ArrowRight className="size-3" />
                    </Link>
                  )}
                </span>
              </div>

              {p.선정결과 === "선정" && (
                <p className="mt-1.5 rounded-md bg-[var(--success)]/40 p-2 text-[12.7px] text-[var(--success-fg)]">
                  다음: 「연구비 계상」 탭의 재원 구성이 이 공고 규칙으로 정부출연금·민간부담금을
                  채워 줍니다. 총사업비는 협약서 금액을 넣으세요(지금 0 입니다).
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {폼열림 && (
        <div className="rounded-md border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[13.2px] text-muted-foreground">
              과제명 (대장에 표시됩니다)
              <Input
                className={cell}
                value={과제명}
                onChange={(e) => set과제명(e.target.value)}
                placeholder={사업명 ?? "사업명"}
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              신청 지원금액 (모르면 비워 둡니다)
              <MoneyInput
                value={지원금액}
                onValueChange={set지원금액}
                className="h-7 text-right text-[13.8px] tabular-nums"
                aria-label="신청 지원금액"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              사업기간 시작 (예정)
              <Input
                type="date"
                className={cell}
                value={시작일}
                onChange={(e) => set시작일(e.target.value)}
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              사업기간 종료 (예정)
              <Input
                type="date"
                className={cell}
                value={종료일}
                onChange={(e) => set종료일(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12.7px] text-muted-foreground">
              협약 전이라 총사업비는 0 으로 둡니다 — 선정 뒤 재원 구성에서 채웁니다
            </span>
            <span className="ml-auto" />
            <Button
              type="button"
              className="h-7 text-[14.1px]"
              disabled={pending}
              onClick={등록}
            >
              {pending ? "등록 중…" : 강제 ? "그래도 한 건 더 등록" : "이 공고에 지원 등록"}
            </Button>
          </div>
        </div>
      )}

      {msg && (
        <p
          className={cn(
            "mt-2 rounded-md p-2 text-[13.8px]",
            msg.ok
              ? "bg-[var(--success)]/40 text-[var(--success-fg)]"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  )
}
