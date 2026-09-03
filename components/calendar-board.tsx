"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/components/status-badge"
import type { CalendarRow, UndatedRow } from "@/lib/queries"

/**
 * 날짜가 없어서 달력에 못 올라가는 것 — 「기다리는 일」.
 *
 * 확정 대기·제출 전 점검·서류 미확보에는 날짜 개념이 아예 없다. 그래서 예전에는
 * 대시보드 맨 아래 「손봐야 할 것」 카드에 따로 있었는데, 카드가 셋이면 화면이 흩어진다.
 * 카드는 없애되 안에 있던 것은 버리지 않는다 — 일정 카드 안으로 들어온다.
 *
 * ⚠ 특히 「확정 대기」를 빠뜨리면 안 된다. 확신도 0.70 미만은 코드가 자동 확정을
 *   막게 해 뒀으므로 사람을 기다리는 줄이 반드시 생기는데, 화면에서 사라지면
 *   그 줄이 쌓이는 것을 아무도 모른다.
 */
export type 대기묶음 = {
  라벨: string
  힌트: string
  링크: string
  건수: number
  항목: { 키: string; 이름: string; 꼬리: string; 배지?: boolean }[]
}

/**
 * 일정 달력 + 목록 패널.
 *
 * 케이오시 현안 세 문제 중 하나가 「일정 착오」다. 마감·협약종료·보고예정·서류만료가
 * 화면마다 흩어져 있으면 「챙겨 보는 사람이 없어 모르고 지나간다」가 그대로 남는다.
 *
 * 2026-09-03 개편(3차)
 *   - 머리 오른쪽 범례를 빼고 그 자리에 펼치기/접기를 뒀다. 접는 버튼이 머리 안쪽에 있으면
 *     달 이동 버튼과 섞여 뭘 누르는지 헷갈린다. 색 뜻은 패널의 각 줄에 글자로 남아 있어
 *     범례가 없어도 읽을 수 있다.
 *   - 격자에서 칸 테두리를 걷어냈다. 날짜를 가운데로 올리고 줄 간격을 키웠다.
 *     선이 많으면 표처럼 보이고, 표처럼 보이면 눈이 숫자를 훑지 않는다.
 *   - 일간/주간/월간 보기를 붙였다. 셋 다 같은 데이터를 다르게 자를 뿐이다.
 *     「목록」은 따로 두지 않았다 — **접은 상태가 곧 목록 보기**다.
 *
 * ⚠ 일정이 없는 달은 접힌 채로 연다. 빈 격자가 세로 460px 를 먹는데 정보가 0이면
 *   「깔끔」이 아니라 「허전」이다. 「아무 일 없으면 조용해야 한다」를 달력에도 적용한다.
 */

const 색: Record<string, { dot: string; text: string }> = {
  관심공고: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  사업종료: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  보고예정: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  결과발표: { dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  서류만료: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
}

/** 「다가오는 일정」을 종류별로 묶을 때의 순서. 급한 것부터. */
const 종류순서 = ["서류만료", "보고예정", "결과발표", "관심공고", "사업종료"]
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
const 달더하기 = (s: string, n: number) => {
  const [y, m] = parse(s)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)
}
const 그달일수 = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const 짧은날짜 = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`

type 보기 = "일간" | "주간" | "월간"
const 보기들: 보기[] = ["일간", "주간", "월간"]

export function CalendarBoard({
  rows,
  undated,
  기다림,
  today,
  error,
}: {
  rows: CalendarRow[]
  undated: UndatedRow[]
  기다림: 대기묶음[]
  today: string
  error?: string | null
}) {
  const [커서, set커서] = React.useState(today) // 보고 있는 기준 날짜
  const [모드, set모드] = React.useState<보기>("월간")
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
  const 이번주것 = Array.from({ length: 7 }, (_, i) => 더하기(주시작, i)).flatMap(
    (d) => 날짜별.get(d) ?? [],
  )

  const [cy, cm] = parse(커서)
  const 달접두 = `${cy}-${pad(cm)}`
  const 이달건수 = rows.filter((r) => r.날짜?.startsWith(달접두)).length
  const 격자 = 펼침 ?? 이달건수 > 0

  // 월간: 주 단위로 꽉 채운다. 앞뒤 달 날짜가 들어가야 달력처럼 보인다.
  const 첫날 = ymd(cy, cm, 1)
  const 월칸 = React.useMemo(() => {
    const 시작 = 더하기(첫날, -요일번호(첫날))
    const n = Math.ceil((요일번호(첫날) + 그달일수(cy, cm)) / 7) * 7
    return Array.from({ length: n }, (_, i) => 더하기(시작, i))
  }, [첫날, cy, cm])
  const 주칸 = React.useMemo(() => {
    const s = 더하기(커서, -요일번호(커서))
    return Array.from({ length: 7 }, (_, i) => 더하기(s, i))
  }, [커서])

  const 이동 = (n: number) => {
    set커서(모드 === "월간" ? 달더하기(커서, n) : 더하기(커서, 모드 === "주간" ? 7 * n : n))
    set선택(null)
  }

  const 제목 =
    모드 === "월간"
      ? `${cy}.${pad(cm)}`
      : 모드 === "주간"
        ? `${짧은날짜(주칸[0])} ~ ${짧은날짜(주칸[6])}`
        : `${cy}.${pad(cm)}.${커서.slice(8)} (${요일[요일번호(커서)]})`

  return (
    <div className="rounded-lg border bg-card">
      {/* ── 머리 ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <h2 className="shrink-0 text-sm font-semibold">일정</h2>

        {격자 && (
          <div className="flex shrink-0 items-center gap-1">
            {보기들.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  set모드(v)
                  set선택(null)
                }}
                aria-pressed={모드 === v}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  모드 === v
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {격자 && (
          <div className="flex flex-1 items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => 이동(-1)}
              aria-label="이전"
              className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ‹
            </button>
            <span className="min-w-[104px] text-center text-[15px] font-medium tabular-nums">
              {제목}
            </span>
            <button
              type="button"
              onClick={() => 이동(1)}
              aria-label="다음"
              className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ›
            </button>
            {커서 !== today && (
              <button
                type="button"
                onClick={() => {
                  set커서(today)
                  set선택(null)
                }}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground"
              >
                오늘
              </button>
            )}
          </div>
        )}

        {/* ★ 예전 범례 자리. 펼치기/접기는 여기 하나뿐이다. */}
        <button
          type="button"
          onClick={() => set펼침(!격자)}
          aria-expanded={격자}
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {격자 ? "달력 접기" : "달력 펼치기"}
          <span aria-hidden className="text-[10px]">
            {격자 ? "▲" : "▼"}
          </span>
        </button>
      </div>

      {/* ── 본문 ─────────────────────────────────────────────── */}
      {error ? (
        <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          일정을 불러오지 못했습니다. 달력 없이도 나머지 화면은 그대로 동작합니다.
          <div className="mt-1 text-xs opacity-70">{error}</div>
        </div>
      ) : !격자 ? (
        <div className="p-3">
          <div className="max-w-3xl">
            <Panel
              선택={null}
              날짜별={날짜별}
              지난것={지난것}
              이번주것={이번주것}
              앞으로={앞으로}
              undated={undated}
              기다림={기다림}
              옆칸={false}
            />
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_300px]">
          <div className="p-3">
            {모드 === "일간" ? (
              <DayView 날짜={커서} rows={날짜별.get(커서) ?? []} today={today} />
            ) : (
              <Grid
                칸={모드 === "월간" ? 월칸 : 주칸}
                달접두={모드 === "월간" ? 달접두 : null}
                today={today}
                선택={선택}
                날짜별={날짜별}
                높이={모드 === "월간" ? "min-h-[92px]" : "min-h-[220px]"}
                onPick={(d, 다른달) => {
                  if (다른달) set커서(d)
                  set선택((s) => (s === d ? null : d))
                }}
              />
            )}
          </div>
          {/* 패널이 길어지면 달력보다 카드가 커진다. 옆칸에서는 안에서 스크롤시킨다. */}
          <div className="border-t p-3 lg:max-h-[560px] lg:overflow-y-auto lg:border-l lg:border-t-0">
            <Panel
              선택={선택}
              날짜별={날짜별}
              지난것={지난것}
              이번주것={이번주것}
              앞으로={앞으로}
              undated={undated}
              기다림={기다림}
              옆칸
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 날짜 격자.
 * ⚠ 칸마다 테두리를 두지 않는다. 선이 많으면 달력이 아니라 표로 보이고,
 *   표로 보이면 눈이 숫자를 훑지 않는다. 구분은 여백으로 한다.
 */
function Grid({
  칸,
  달접두,
  today,
  선택,
  날짜별,
  높이,
  onPick,
}: {
  칸: string[]
  달접두: string | null // null 이면 전부 이번 범위(주간)
  today: string
  선택: string | null
  날짜별: Map<string, CalendarRow[]>
  높이: string
  onPick: (날짜: string, 다른달: boolean) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b">
        {요일.map((w, i) => (
          <div
            key={w}
            className={cn(
              "py-2 text-center text-xs font-medium",
              i === 0 ? "text-rose-500" : "text-muted-foreground",
            )}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {칸.map((d, i) => {
          const 이번범위 = 달접두 === null || d.startsWith(달접두)
          const 목록 = 날짜별.get(d) ?? []
          const 오늘 = d === today
          const 골라짐 = d === 선택
          const 일요일 = i % 7 === 0
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d, !이번범위)}
              aria-pressed={골라짐}
              aria-current={오늘 ? "date" : undefined}
              className={cn(
                높이,
                "px-1 pb-1 pt-2 text-left align-top transition-colors",
                골라짐 ? "bg-muted" : "hover:bg-muted/40",
              )}
            >
              <span className="block text-center">
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-[13px] tabular-nums",
                    오늘
                      ? "bg-foreground font-semibold text-background"
                      : !이번범위
                        ? "text-muted-foreground/40"
                        : 일요일
                          ? "text-rose-500"
                          : "text-foreground",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
              </span>

              <span className={cn("mt-1 block space-y-0.5", !이번범위 && "opacity-50")}>
                {목록.slice(0, 3).map((r) => (
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
                {목록.length > 3 && (
                  <span className="block pl-2.5 text-[11px] text-muted-foreground">
                    +{목록.length - 3}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 일간 보기 — 하루치만 크게. 격자를 그릴 이유가 없다. */
function DayView({
  날짜,
  rows,
  today,
}: {
  날짜: string
  rows: CalendarRow[]
  today: string
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[15px] font-medium tabular-nums">
          {Number(날짜.slice(5, 7))}월 {Number(날짜.slice(8))}일
        </span>
        <span className="text-xs text-muted-foreground">
          {요일[요일번호(날짜)]}요일{날짜 === today && " · 오늘"}
        </span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {rows.length}건
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          이 날 일정이 없습니다
        </p>
      ) : (
        <Items rows={rows} />
      )}
    </div>
  )
}

/** 목록 패널. 접힌 상태에서는 넓게, 펼친 상태에서는 오른쪽 세로 칸에 들어간다. */
function Panel({
  선택,
  날짜별,
  지난것,
  이번주것,
  앞으로,
  undated,
  기다림,
  옆칸,
}: {
  선택: string | null
  날짜별: Map<string, CalendarRow[]>
  지난것: CalendarRow[]
  이번주것: CalendarRow[]
  앞으로: CalendarRow[]
  undated: UndatedRow[]
  기다림: 대기묶음[]
  옆칸: boolean
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

  // 이번 주에 든 것은 「다가오는」에서 뺀다. 같은 줄이 두 번 나오면 건수를 못 믿는다.
  const 이번주키 = new Set(이번주것.map((r) => r.종류 + r.참조키 + r.날짜))
  const 나중 = 앞으로.filter((r) => !이번주키.has(r.종류 + r.참조키 + r.날짜))

  // 「다가오는 일정」을 종류별로 나눈다. 만료된 서류 · 보고 제출 · 결과 발표가
  // 한 덩어리로 섞여 있으면 무엇을 준비해야 하는지가 안 보인다.
  // ⚠ 0건인 종류는 그리지 않는다. 「아무 일 없으면 조용해야 한다」.
  const 그룹 = new Map<string, CalendarRow[]>()
  for (const r of 나중) {
    const g = 그룹.get(r.종류)
    if (g) g.push(r)
    else 그룹.set(r.종류, [r])
  }
  const 그룹순 = [...그룹.keys()].sort((a, b) => {
    const i = 종류순서.indexOf(a)
    const j = 종류순서.indexOf(b)
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j)
  })

  const 대기 = 기다림.filter((g) => g.건수 > 0)
  const 아무것도없음 =
    지난것.length === 0 &&
    이번주것.length === 0 &&
    나중.length === 0 &&
    undated.length === 0 &&
    대기.length === 0

  return (
    <>
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

      {그룹순.length > 0 && (
        <div className={cn(이번주것.length > 0 && "mt-3")}>
          <Head title="다가오는 일정" n={나중.length} />
          {그룹순.map((종류) => {
            const list = 그룹.get(종류)!
            return (
              <div key={종류} className="mb-1.5">
                <div className="flex items-baseline gap-1.5 px-2">
                  <span className={cn("text-xs font-medium", 색깔(종류).text)}>{종류}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {list.length}
                  </span>
                </div>
                <Items rows={list.slice(0, 3)} 날짜표시 />
                {list.length > 3 && (
                  <p className="px-2 text-xs text-muted-foreground">외 {list.length - 3}건</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ★ 날짜가 없어 달력에 못 올리는 것 — 예전 「손봐야 할 것」 카드가 여기로 들어왔다. */}
      {대기.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <h4 className="mb-1.5 text-[13px] font-medium">기다리는 일</h4>
          {대기.map((g) => (
            <div key={g.라벨} className="mb-2">
              <div className="flex items-baseline gap-1.5 px-2">
                <Link href={g.링크} className="text-xs font-medium hover:underline">
                  {g.라벨}
                </Link>
                <span className="text-xs tabular-nums text-muted-foreground">{g.건수}</span>
                <span className="truncate text-xs text-muted-foreground">{g.힌트}</span>
              </div>
              <ul className="space-y-0.5">
                {g.항목.map((it) => (
                  <li
                    key={it.키}
                    className="flex items-center gap-2 px-2 py-0.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate">{it.이름}</span>
                    <span className="shrink-0">
                      {it.배지 ? (
                        <StatusBadge value={it.꼬리} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{it.꼬리}</span>
                      )}
                    </span>
                  </li>
                ))}
                {g.건수 > g.항목.length && (
                  <li className="px-2 text-xs text-muted-foreground">
                    외 {g.건수 - g.항목.length}건
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* 관심 공고인데 마감이 날짜가 아닌 것(상시·소진시). 없애면 조용히 사라진다. */}
      {undated.length > 0 && (
        <div className="mt-3 border-t pt-2">
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

      {아무것도없음 && (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          지금 손댈 것이 없습니다
        </p>
      )}
    </>
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
              {/* 색만으로 구분하지 않는다 — 종류를 글자로 같이 적는다. 범례를 뺀 이유이기도 하다. */}
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
