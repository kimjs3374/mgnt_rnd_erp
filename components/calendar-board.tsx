"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalendarRow } from "@/lib/queries"

/**
 * 일정 달력 — 좁은 칸에 들어가는 배지형 월간 달력.
 *
 * 케이오시 현안 셋 중 하나가 「일정 착오」다. 마감·협약종료·보고예정·서류만료가
 * 화면마다 흩어져 있으면 「챙겨 보는 사람이 없어 모르고 지나간다」가 그대로 남는다.
 *
 * 2026-09-03 개편(5차) — 카드가 절반 폭으로 줄면서 통째로 다시 만들었다.
 *   ① **칸에 제목을 넣지 않고 건수 배지만 찍는다.** 절반 폭이면 칸이 80px 남짓인데
 *      제목을 넣으면 한 글자도 못 읽는다. 배지는 들어간다.
 *      제목은 날짜를 눌러 아래 목록에서 본다.
 *   ② **일간·주간 보기를 없앴다.** 배지 격자에서 주간은 정보가 안 늘고 자리만 먹는다.
 *   ③ **「+」(일정 추가) 버튼을 넣지 않는다.** 이 시스템에 일정을 손으로 만드는 기능이 없다.
 *      일정은 관심표시(watchlist)와 사업 날짜에서 자동으로 생긴다.
 *      눌러도 아무 일 없는 버튼은 심사 「틀릴 때 어떻게 되는가」에서 그대로 감점이다.
 *   ④ 「기다리는 일」(날짜 없는 것)은 이 카드에서 나가 각자 큐 카드가 됐다.
 *
 * ⚠ **「지난 일정」은 어느 달을 보고 있든 목록 맨 위에 고정한다.** 이미 놓친 것이
 *   지난달 칸에 숨으면 아무도 모른다. 예전엔 별도 카드가 받아 줬는데 그 카드가 없어졌다.
 */

const 색: Record<string, { dot: string; badge: string; text: string }> = {
  관심공고: { dot: "bg-blue-500",    badge: "bg-blue-500",    text: "text-blue-600 dark:text-blue-400" },
  사업종료: { dot: "bg-emerald-500", badge: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  보고예정: { dot: "bg-amber-500",   badge: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400" },
  결과발표: { dot: "bg-violet-500",  badge: "bg-violet-500",  text: "text-violet-600 dark:text-violet-400" },
  서류만료: { dot: "bg-rose-500",    badge: "bg-rose-500",    text: "text-rose-600 dark:text-rose-400" },
  신청마감: { dot: "bg-red-600",     badge: "bg-red-600",     text: "text-red-600 dark:text-red-400" },
}
const 기본색 = { dot: "bg-muted-foreground", badge: "bg-muted-foreground", text: "text-muted-foreground" }
const 색깔 = (종류: string) => 색[종류] ?? 기본색

/** 급한 순서. 한 날에 여러 종류가 겹치면 배지는 이 중 앞선 것의 색을 쓴다. */
const 종류순서 = ["신청마감", "서류만료", "보고예정", "결과발표", "관심공고", "사업종료"]
const 급한정도 = (종류: string) => {
  const i = 종류순서.indexOf(종류)
  return i < 0 ? 99 : i
}

const 요일 = ["일", "월", "화", "수", "목", "금", "토"]

// 날짜 계산은 전부 UTC 로 한다. 브라우저 시간대에 따라 하루가 밀리는 것을 막는다.
// 「오늘」은 서버가 Asia/Seoul 로 계산해 문자열로 내려준다.
const pad = (n: number) => String(n).padStart(2, "0")
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const parse = (s: string) => s.split("-").map(Number) as [number, number, number]
const 요일번호 = (s: string) => {
  const [y, m, d] = parse(s)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
const 더하기 = (s: string, n: number) => {
  const [y, m, d] = parse(s)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
const 달더하기 = (s: string, n: number) => {
  const [y, m] = parse(s)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)
}
const 그달일수 = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const 짧은날짜 = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`

export function CalendarBoard({
  rows,
  today,
  error,
}: {
  rows: CalendarRow[]
  today: string
  error?: string | null
}) {
  const [커서, set커서] = React.useState(today)
  const [선택, set선택] = React.useState<string | null>(null)

  const 날짜별 = React.useMemo(() => {
    const m = new Map<string, CalendarRow[]>()
    for (const r of rows) {
      if (!r.날짜) continue
      const list = m.get(r.날짜)
      if (list) list.push(r)
      else m.set(r.날짜, [r])
    }
    for (const list of m.values()) list.sort((a, b) => 급한정도(a.종류) - 급한정도(b.종류))
    return m
  }, [rows])

  /** 이미 놓친 것. 어느 달을 보고 있든 맨 위에 세운다. */
  const 지난것 = React.useMemo(
    () =>
      rows
        .filter((r) => r.d_day != null && r.d_day < 0)
        .sort((a, b) => (b.d_day ?? 0) - (a.d_day ?? 0)),
    [rows],
  )

  /** 앞으로 올 것 중 가장 가까운 하나. 배지가 없는 달을 열었을 때 길을 알려준다. */
  const 다음것 = React.useMemo(
    () =>
      rows
        .filter((r) => r.d_day != null && r.d_day >= 0)
        .sort((a, b) => (a.d_day ?? 0) - (b.d_day ?? 0))[0] ?? null,
    [rows],
  )

  const [cy, cm] = parse(커서)
  const 달접두 = `${cy}-${pad(cm)}`
  const 이달것 = React.useMemo(
    () =>
      rows
        .filter((r) => r.날짜?.startsWith(달접두))
        .sort((a, b) => a.날짜.localeCompare(b.날짜)),
    [rows, 달접두],
  )

  const 첫날 = ymd(cy, cm, 1)
  const 월칸 = React.useMemo(() => {
    const 시작 = 더하기(첫날, -요일번호(첫날))
    const n = Math.ceil((요일번호(첫날) + 그달일수(cy, cm)) / 7) * 7
    return Array.from({ length: n }, (_, i) => 더하기(시작, i))
  }, [첫날, cy, cm])

  const 이동 = (n: number) => {
    set커서(달더하기(커서, n))
    set선택(null)
  }

  const 목록 = 선택 ? (날짜별.get(선택) ?? []) : 이달것

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      {/* ── 머리 ─────────────────────────────────────────────
          2026-09-03 개편(6차): 「오늘」 버튼이 나타났다 사라지면서 ‹ 월 › 이 좌우로
          밀리는 게 지적됐다(당연하다 — 한 줄 flex 라 오른쪽 내용이 줄면 왼쪽 그룹이
          가장자리로 밀린다). 가운데 월 이동은 **절대 위치로 화면 가운데 고정**하고,
          오른쪽 「오늘」은 없을 때도 자리를 차지하게 `invisible` 로 둔다.
          그러면 셋 중 뭐가 나타나든 사라지든 가운데는 흔들리지 않는다. */}
      <div className="relative flex items-center gap-2 border-b px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--warning)] text-[var(--warning-fg)]">
          <CalendarDays className="size-3.5" />
        </span>
        <h2 className="text-sm font-semibold">일정</h2>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          <button
            type="button"
            onClick={() => 이동(-1)}
            aria-label="이전 달"
            className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ‹
          </button>
          <span className="min-w-[68px] text-center text-[16.5px] font-medium tabular-nums">
            {cy}.{pad(cm)}
          </span>
          <button
            type="button"
            onClick={() => 이동(1)}
            aria-label="다음 달"
            className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ›
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            set커서(today)
            set선택(null)
          }}
          disabled={달접두 === today.slice(0, 7)}
          className={cn(
            "ml-auto text-xs text-muted-foreground hover:text-foreground",
            달접두 === today.slice(0, 7) && "invisible",
          )}
        >
          오늘
        </button>
      </div>

      {error ? (
        <p className="px-4 py-10 text-center text-[14.3px] text-muted-foreground">
          일정을 불러오지 못했습니다. 달력 없이도 나머지 화면은 그대로 동작합니다.
          <span className="mt-1 block text-xs opacity-70">{error}</span>
        </p>
      ) : (
        <>
          {/* ── 격자 ─────────────────────────────────────── */}
          <div className="p-3">
            <div className="grid grid-cols-7">
              {요일.map((w, i) => (
                <div
                  key={w}
                  className={cn(
                    "pb-1 text-center text-xs font-medium",
                    i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-muted-foreground",
                  )}
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {월칸.map((d, i) => {
                const 이번달 = d.startsWith(달접두)
                const 그날 = 날짜별.get(d) ?? []
                const 오늘 = d === today
                const 골라짐 = d === 선택
                const 일 = i % 7 === 0
                const 토 = i % 7 === 6
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      if (!이번달) set커서(d)
                      set선택((s) => (s === d ? null : d))
                    }}
                    aria-pressed={골라짐}
                    aria-current={오늘 ? "date" : undefined}
                    aria-label={`${d} · 일정 ${그날.length}건`}
                    className={cn(
                      "flex min-h-[46px] flex-col items-center gap-0.5 rounded pt-1.5 transition-colors",
                      골라짐 ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-[14.3px] tabular-nums",
                        오늘
                          ? "bg-foreground font-semibold text-background"
                          : !이번달
                            ? "text-muted-foreground/40"
                            : 일
                              ? "text-rose-500"
                              : 토
                                ? "text-blue-500"
                                : "text-foreground",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {그날.length > 0 && (
                      <span
                        className={cn(
                          "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1",
                          "text-[11px] font-semibold tabular-nums text-white",
                          색깔(그날[0].종류).badge,
                          !이번달 && "opacity-50",
                        )}
                      >
                        {그날.length}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── 목록 ─────────────────────────────────────── */}
          <div className="flex-1 border-t p-3">
            {지난것.length > 0 && (
              <div className="mb-2 rounded border border-destructive/30 bg-destructive/5 p-2">
                <h3 className="mb-1 text-[12.1px] font-semibold tracking-wide text-destructive">
                  지난 일정 {지난것.length}건
                </h3>
                <Items rows={지난것} 지남 />
              </div>
            )}

            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="text-[12.1px] font-semibold tracking-wide text-muted-foreground">
                {선택
                  ? `${Number(선택.slice(5, 7))}월 ${Number(선택.slice(8))}일`
                  : `${cm}월 일정`}
              </h3>
              <span className="text-[12.1px] tabular-nums text-muted-foreground">
                {목록.length}건
              </span>
            </div>

            {목록.length === 0 ? (
              <p className="py-3 text-center text-[14.3px] text-muted-foreground">
                {선택 ? (
                  "이 날 일정이 없습니다"
                ) : 다음것 ? (
                  <>
                    이 달은 비어 있습니다 · 다음 일정{" "}
                    <Link href={다음것.링크} className="text-primary hover:underline">
                      {짧은날짜(다음것.날짜)} {다음것.종류}
                    </Link>{" "}
                    <span className="tabular-nums">
                      {다음것.d_day === 0 ? "오늘" : `D-${다음것.d_day}`}
                    </span>
                  </>
                ) : (
                  "잡혀 있는 일정이 없습니다"
                )}
              </p>
            ) : (
              <Items rows={목록} 날짜표시={!선택} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Items({
  rows,
  지남,
  날짜표시,
}: {
  rows: CalendarRow[]
  지남?: boolean
  날짜표시?: boolean
}) {
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => (
        <li key={r.종류 + r.참조키 + r.날짜}>
          <Link href={r.링크} className="flex gap-2 rounded px-1.5 py-1 hover:bg-muted">
            <i
              className={cn("mt-1.5 size-2 shrink-0 rounded-full", 색깔(r.종류).dot)}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.3px]">{r.제목}</span>
              {/* 색만으로 구분하지 않는다 — 종류를 글자로 같이 적는다. */}
              <span className="block truncate text-xs text-muted-foreground">
                <span className={색깔(r.종류).text}>{r.종류}</span>
                {날짜표시 && ` · ${짧은날짜(r.날짜)}`}
                {r.부제 ? ` · ${r.부제}` : ""}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                지남 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {r.d_day == null
                ? ""
                : r.d_day < 0
                  ? `${Math.abs(r.d_day)}일 지남`
                  : r.d_day === 0
                    ? "오늘"
                    : `D-${r.d_day}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
