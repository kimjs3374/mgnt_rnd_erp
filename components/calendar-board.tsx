"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { CalendarRow, UndatedRow } from "@/lib/queries"

/**
 * 일정 달력 + 목록 패널.
 *
 * 케이오시 현안 세 문제 중 하나가 「일정 착오」다. 마감·협약종료·보고예정·서류만료가
 * 화면마다 흩어져 있으면 「챙겨 보는 사람이 없어 모르고 지나간다」가 그대로 남는다.
 *
 * ⚠ 2026-09-03 개편: **일정이 없는 달은 격자를 접는다.**
 *   빈 30칸이 세로 460px 를 먹는데 정보가 0이었다. 화면에서 제일 큰 덩어리가 제일 비어
 *   있으면 「깔끔」이 아니라 「허전」이다. 「아무 일 없으면 조용해야 한다」는 원칙을
 *   달력 자신에게도 적용한다. 사람이 직접 펼칠 수는 있다.
 *
 * 왜 모달이 아니라 옆 패널인가:
 *   ① 모달은 달력을 가린다 — 달력을 보는 이유가 「이번 주에 뭐가 몰렸나」인데 그게 가려진다.
 *   ② 발표는 통합 PC 1대에 6분이다. 패널은 클릭 없이도 내용이 보인다.
 *   ③ ★ 날짜가 없는 것을 둘 자리가 생긴다. 접수기간의 56%가 날짜가 아니다(상시·소진시).
 *
 * ⚠ 색만으로 구분하지 않는다. 범례에 글자를 같이 두고 패널 각 줄에도 종류를 적는다.
 */

const 색: Record<string, { dot: string; text: string }> = {
  관심공고: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  사업종료: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  보고예정: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  서류만료: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
}
const 기본색 = { dot: "bg-muted-foreground", text: "text-muted-foreground" }
const 색깔 = (종류: string) => 색[종류] ?? 기본색

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
const 그달일수 = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const 짧은날짜 = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`

export function CalendarBoard({
  rows,
  undated,
  today,
  error,
}: {
  rows: CalendarRow[]
  undated: UndatedRow[]
  today: string
  error?: string | null
}) {
  const [ty, tm] = parse(today)
  const [기준, set기준] = React.useState({ y: ty, m: tm })
  const [선택, set선택] = React.useState<string | null>(null)
  // null = 자동(일정 있으면 펼침). true/false = 사람이 직접 정한 것.
  const [펼침, set펼침] = React.useState<boolean | null>(null)

  const 날짜별 = React.useMemo(() => {
    const m = new Map<string, CalendarRow[]>()
    for (const r of rows) {
      if (!r.날짜) continue
      const list = m.get(r.날짜)
      if (list) list.push(r)
      else m.set(r.날짜, [r])
    }
    return m
  }, [rows])

  /** 이미 놓친 것. 지난달 칸에 숨으면 안 되므로 어느 달을 보고 있든 맨 위에 세운다. */
  const 지난것 = React.useMemo(
    () =>
      rows
        .filter((r) => r.d_day != null && r.d_day < 0)
        .sort((a, b) => (b.d_day ?? 0) - (a.d_day ?? 0)),
    [rows],
  )
  const 앞으로 = React.useMemo(
    () =>
      rows
        .filter((r) => r.d_day != null && r.d_day >= 0)
        .sort((a, b) => (a.d_day ?? 0) - (b.d_day ?? 0)),
    [rows],
  )

  const 주시작 = 더하기(today, -요일번호(today))
  const 주 = Array.from({ length: 7 }, (_, i) => 더하기(주시작, i))
  const 이번주것 = 주.flatMap((d) => 날짜별.get(d) ?? [])

  const 이달건수 = rows.filter((r) => r.날짜?.startsWith(`${기준.y}-${pad(기준.m)}`)).length
  const 격자 = 펼침 ?? 이달건수 > 0

  const 이동 = (delta: number) => {
    const t = new Date(Date.UTC(기준.y, 기준.m - 1 + delta, 1))
    set기준({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 })
    set선택(null)
    set펼침(null) // 달을 옮기면 다시 자동 판단으로 돌아간다
  }

  const 쓰인종류 = [...new Set(rows.map((r) => r.종류))]

  const 머리 = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">일정</h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => 이동(-1)}
            aria-label="이전 달"
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ‹
          </button>
          <span className="min-w-[92px] text-center text-[13px] tabular-nums">
            {기준.y}년 {기준.m}월
          </span>
          <button
            type="button"
            onClick={() => 이동(1)}
            aria-label="다음 달"
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ›
          </button>
        </div>
        {(기준.y !== ty || 기준.m !== tm || 선택) && (
          <button
            type="button"
            onClick={() => {
              set기준({ y: ty, m: tm })
              set선택(null)
              set펼침(null)
            }}
            className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          >
            오늘
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {쓰인종류.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <i className={cn("size-2 rounded-full", 색깔(k).dot)} aria-hidden />
            {k}
          </span>
        ))}
      </div>
    </div>
  )

  if (error) {
    return (
      <div className="rounded-lg border bg-card">
        {머리}
        <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          일정을 불러오지 못했습니다. 달력 없이도 나머지 화면은 그대로 동작합니다.
          <div className="mt-1 text-xs opacity-70">{error}</div>
        </div>
      </div>
    )
  }

  const 목록 = (
    <Panel
      선택={선택}
      날짜별={날짜별}
      지난것={지난것}
      이번주것={이번주것}
      앞으로={앞으로}
      undated={undated}
      격자={격자}
    />
  )

  return (
    <div className="rounded-lg border bg-card">
      {머리}

      {격자 ? (
        <div className="grid lg:grid-cols-[1fr_300px]">
          <div className="p-3">
            <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
              {요일.map((w, i) => (
                <div
                  key={w}
                  className={cn("pb-1", i === 0 && "text-rose-500", i === 6 && "text-blue-500")}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px rounded border bg-border">
              {[
                ...Array.from({ length: 요일번호(ymd(기준.y, 기준.m, 1)) }, () => null),
                ...Array.from({ length: 그달일수(기준.y, 기준.m) }, (_, i) =>
                  ymd(기준.y, 기준.m, i + 1),
                ),
              ].map((d, i) => {
                if (!d) return <div key={`b${i}`} className="min-h-[64px] bg-card" />
                const 목록칸 = 날짜별.get(d) ?? []
                const 오늘 = d === today
                const 골라짐 = d === 선택
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set선택(골라짐 ? null : d)}
                    aria-pressed={골라짐}
                    className={cn(
                      "min-h-[64px] bg-card p-1 text-left align-top transition-colors hover:bg-muted/60",
                      골라짐 && "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                        오늘
                          ? "bg-primary font-semibold text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    <span className="mt-0.5 block space-y-0.5">
                      {목록칸.slice(0, 2).map((r) => (
                        <span
                          key={r.종류 + r.참조키}
                          className="flex items-center gap-1 text-[11px] leading-tight"
                          title={`${r.종류} · ${r.제목}`}
                        >
                          <i
                            className={cn("size-1.5 shrink-0 rounded-full", 색깔(r.종류).dot)}
                            aria-hidden
                          />
                          <span className="truncate">{r.제목}</span>
                        </span>
                      ))}
                      {목록칸.length > 2 && (
                        <span className="block text-[11px] text-muted-foreground">
                          +{목록칸.length - 2}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="border-t p-3 lg:border-l lg:border-t-0">{목록}</div>
        </div>
      ) : (
        /* 접힌 상태 — 빈 격자로 세로를 먹지 않는다 */
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2 rounded border border-dashed px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              {기준.y}년 {기준.m}월에는 일정이 없습니다
            </span>
            <button
              type="button"
              onClick={() => set펼침(true)}
              className="shrink-0 text-xs text-primary hover:underline"
            >
              달력 펼치기
            </button>
          </div>
          {목록}
        </div>
      )}
    </div>
  )
}

/** 목록 패널. 접힌 상태에서는 가로로 넓게, 펼친 상태에서는 오른쪽 세로 칸에 들어간다. */
function Panel({
  선택,
  날짜별,
  지난것,
  이번주것,
  앞으로,
  undated,
  격자,
}: {
  선택: string | null
  날짜별: Map<string, CalendarRow[]>
  지난것: CalendarRow[]
  이번주것: CalendarRow[]
  앞으로: CalendarRow[]
  undated: UndatedRow[]
  격자: boolean
}) {
  if (선택) {
    const 목록 = 날짜별.get(선택) ?? []
    return (
      <>
        <Head title={`${Number(선택.slice(5, 7))}월 ${Number(선택.slice(8))}일`} n={목록.length} />
        {목록.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            이 날 일정이 없습니다
          </p>
        ) : (
          <Items rows={목록} />
        )}
      </>
    )
  }

  // 이번 주가 비면 「이번 주 일정이 없습니다」로 칸을 낭비하지 않고 다음 일정을 보여준다.
  // 3건까지만 — 넉 달 뒤 일정을 다섯 줄 늘어놓는 건 「행동이 필요한 것만」에서 멀어진다.
  const 다음 = 이번주것.length > 0 ? null : 앞으로.slice(0, 3)
  const 아무것도없음 =
    지난것.length === 0 && 이번주것.length === 0 && (다음?.length ?? 0) === 0 && undated.length === 0

  return (
    <div
      className={cn(
        // 접힌 상태는 가로가 1,300px 까지 벌어진다. 「50일 지남」이 항목명에서 멀어지면
        // 눈이 짝을 못 맞춘다. 폭을 묶어 둔다.
        !격자 && "max-w-3xl",
        !격자 && undated.length > 0 && "sm:grid sm:grid-cols-2 sm:gap-4",
      )}
    >
      <div>
        {지난것.length > 0 && (
          <div className="mb-2 rounded border border-destructive/30 bg-destructive/5 p-2">
            <h4 className="mb-1 text-xs font-medium text-destructive">
              지난 일정 {지난것.length}건
            </h4>
            <Items rows={지난것} 지남 />
          </div>
        )}

        {이번주것.length > 0 && (
          <>
            <Head title="이번 주" n={이번주것.length} />
            <Items rows={이번주것} />
          </>
        )}

        {다음 && 다음.length > 0 && (
          <>
            <Head title="다가오는 일정" n={다음.length} />
            <Items rows={다음} 날짜표시 />
          </>
        )}

        {아무것도없음 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            예정된 일정이 없습니다
          </p>
        )}
      </div>

      {/* ★ 날짜가 없어 달력에 못 올리는 것. 없애면 관심 공고가 조용히 사라진다. */}
      {undated.length > 0 && (
        <div className={cn(격자 && "mt-3 border-t pt-2")}>
          <h4 className="mb-1 text-xs text-muted-foreground">날짜 미정 {undated.length}건</h4>
          <ul className="space-y-0.5">
            {undated.map((u) => (
              <li key={u.참조키}>
                <Link
                  href={u.링크}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{u.제목}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{u.사유}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Head({ title, n }: { title: string; n: number }) {
  return (
    <div className="mb-1 flex items-baseline justify-between">
      <h3 className="text-[13px] font-medium">{title}</h3>
      <span className="text-xs tabular-nums text-muted-foreground">{n}건</span>
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
          <Link href={r.링크} className="flex gap-2 rounded px-2 py-1 hover:bg-muted">
            <i
              className={cn("mt-1.5 size-2 shrink-0 rounded-full", 색깔(r.종류).dot)}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{r.제목}</span>
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
