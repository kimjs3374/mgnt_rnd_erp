"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { CalendarRow, UndatedRow } from "@/lib/queries"

/**
 * 일정 달력 + 이번 주 패널.
 *
 * 케이오시 현안 세 문제 중 하나가 「일정 착오」다. 마감·협약종료·보고예정·서류만료가
 * 화면마다 흩어져 있으면 「챙겨 보는 사람이 없어 모르고 지나간다」가 그대로 남는다.
 *
 * 왜 모달이 아니라 옆 패널인가 (2026-09-03 결정):
 *   ① 모달은 달력을 가린다. 달력을 보는 이유가 「이번 주에 뭐가 몰렸나」인데 그게 가려진다.
 *   ② 발표는 통합 PC 1대에 6분이다. 패널은 클릭 없이도 내용이 보인다.
 *   ③ ★ 날짜가 없는 것을 둘 자리가 생긴다. 접수기간의 56%가 날짜가 아니다(상시·소진시).
 *      모달만 있으면 그 공고들이 화면에서 통째로 사라진다.
 *
 * ⚠ 색만으로 구분하지 않는다. 범례에 글자를 같이 두고, 패널의 각 줄에도 종류를 적는다.
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
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
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

  // 이번 주 = 오늘이 속한 일~토
  const 주시작 = 더하기(today, -요일번호(today))
  const 주 = Array.from({ length: 7 }, (_, i) => 더하기(주시작, i))

  const 패널행 = React.useMemo(() => {
    const 대상 = 선택 ? [선택] : 주
    return 대상.flatMap((d) => (날짜별.get(d) ?? []).map((r) => ({ ...r, 날짜: d })))
  }, [선택, 날짜별, today])

  /**
   * ★ 지난 일정은 달력에서 안 보인다 — 지난달 칸에 있기 때문이다.
   * 「일정 착오를 막는다」가 목적인 화면에서 이미 놓친 것이 숨으면 안 된다.
   * 어느 달을 보고 있든 패널 맨 위에 세운다. 없으면 아예 안 그린다.
   */
  const 지난것 = React.useMemo(
    () =>
      rows
        .filter((r) => r.d_day != null && r.d_day < 0)
        .sort((a, b) => (b.d_day ?? 0) - (a.d_day ?? 0)),
    [rows],
  )

  const 이동 = (delta: number) => {
    const t = new Date(Date.UTC(기준.y, 기준.m - 1 + delta, 1))
    set기준({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 })
    set선택(null)
  }

  const 일수 = 그달일수(기준.y, 기준.m)
  const 앞공백 = 요일번호(ymd(기준.y, 기준.m, 1))
  const 칸 = [
    ...Array.from({ length: 앞공백 }, () => null),
    ...Array.from({ length: 일수 }, (_, i) => ymd(기준.y, 기준.m, i + 1)),
  ]

  const 쓰인종류 = [...new Set(rows.map((r) => r.종류))]

  return (
    <div className="rounded-lg border bg-card">
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
              }}
              className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              오늘
            </button>
          )}
        </div>

        {/* 범례 — 색 옆에 반드시 글자를 둔다 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {쓰인종류.length === 0 ? (
            <span>표시할 일정 없음</span>
          ) : (
            쓰인종류.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <i className={cn("size-2 rounded-full", 색깔(k).dot)} aria-hidden />
                {k}
              </span>
            ))
          )}
        </div>
      </div>

      {error ? (
        <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          일정을 불러오지 못했습니다. 달력 없이도 나머지 화면은 그대로 동작합니다.
          <div className="mt-1 text-xs opacity-70">{error}</div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_300px]">
          {/* 달력 */}
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
              {칸.map((d, i) => {
                if (!d) return <div key={`b${i}`} className="min-h-[76px] bg-card" />
                const 목록 = 날짜별.get(d) ?? []
                const 오늘 = d === today
                const 골라짐 = d === 선택
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set선택(골라짐 ? null : d)}
                    aria-pressed={골라짐}
                    className={cn(
                      "min-h-[76px] bg-card p-1 text-left align-top transition-colors hover:bg-muted/60",
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
                      {목록.slice(0, 2).map((r) => (
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
                      {목록.length > 2 && (
                        <span className="block text-[11px] text-muted-foreground">
                          +{목록.length - 2}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 패널 */}
          <div className="border-t p-3 lg:border-l lg:border-t-0">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[13px] font-medium">
                {선택 ? `${Number(선택.slice(5, 7))}월 ${Number(선택.slice(8))}일` : "이번 주"}
              </h3>
              <span className="text-xs text-muted-foreground">{패널행.length}건</span>
            </div>

            {!선택 && 지난것.length > 0 && (
              <div className="mb-2 rounded border border-destructive/30 bg-destructive/5 p-2">
                <h4 className="mb-1 text-xs font-medium text-destructive">
                  지난 일정 {지난것.length}건
                </h4>
                <ul className="space-y-0.5">
                  {지난것.map((r) => (
                    <li key={"od" + r.종류 + r.참조키}>
                      <Link
                        href={r.링크}
                        className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted"
                      >
                        <i
                          className={cn("size-2 shrink-0 rounded-full", 색깔(r.종류).dot)}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{r.제목}</span>
                        <span className="shrink-0 text-xs tabular-nums text-destructive">
                          {Math.abs(r.d_day!)}일 지남
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {패널행.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {선택 ? "이 날 일정이 없습니다" : "이번 주 일정이 없습니다"}
              </p>
            ) : (
              <ul className="space-y-1">
                {패널행.map((r) => (
                  <li key={r.종류 + r.참조키 + r.날짜}>
                    <Link
                      href={r.링크}
                      className="flex gap-2 rounded px-2 py-1.5 hover:bg-muted"
                    >
                      <i
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", 색깔(r.종류).dot)}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{r.제목}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className={색깔(r.종류).text}>{r.종류}</span>
                          {r.부제 ? ` · ${r.부제}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {r.d_day == null
                          ? ""
                          : r.d_day < 0
                            ? "지남"
                            : r.d_day === 0
                              ? "오늘"
                              : `D-${r.d_day}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {/* ★ 날짜가 없어 달력에 못 올리는 것. 없애면 관심 공고가 조용히 사라진다. */}
            {undated.length > 0 && (
              <div className="mt-3 border-t pt-2">
                <h4 className="mb-1 text-xs text-muted-foreground">
                  날짜 미정 {undated.length}건
                </h4>
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
        </div>
      )}
    </div>
  )
}
