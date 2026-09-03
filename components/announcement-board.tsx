"use client"

import * as React from "react"
import Link from "next/link"
import { Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toggleWatch } from "@/app/actions/watchlist"
import type { BoardRow, UndatedRow } from "@/lib/queries"

/**
 * 공고 확인 보드 — 대시보드 맨 위. **새로 올라온 것만** 본다.
 *
 * 2026-09-03 개편(3차) — 공고 탐색이 이미 쓰는 자격판정을 그대로 가져와 붙인다.
 *   ⚠ 「관련 공고만」을 새로 만들지 않는다. `/announcements`·`/project-announcements`
 *     가 이미 쓰는 **자격판정**(가능·불가·확인필요·요건미확인, `lib/queries.ts`·
 *     `lib/queries-programs.ts` 의 `판정계산`)이 있다. 그 결과만 id 로 붙인다
 *     (`판정` prop, 서버 컴포넌트가 두 함수를 불러 만든 Record). 새 판정 로직을
 *     만들면 판정이 두 벌이 되고 한쪽만 고쳐지는 사고가 시연장에서 드러난다(§3.6).
 *   ⚠ 탭은 `구분`(funding_schemes.대분류, 대부분 비어 있다) 대신 **`출처`**로 가른다.
 *     기업마당·K-Startup → 지원사업, IRIS·NTIS → 과제.
 *   ⚠ 「외 N건 링크」 대신 **페이지 넘김**을 쓴다. 이 카드가 「오늘 새로 올라온 것을
 *     확인하는 자리」인데 5줄만 보여주고 나머지는 다른 화면으로 떠넘기면 카드의
 *     목적 자체가 성립하지 않는다. 페이지당 줄 수는 고정해 빈 줄로 채운다 —
 *     마지막 페이지가 짧다고 카드 키가 들쭉날쭉하면 아래 카드가 흔들린다.
 *   ⚠ 이미 마감된 공고는 뺀다. `신규`(오늘 게시·수집)는 접수기간이 지난 공고도
 *     새로 잡는다 — 실제로 마감된 공고가 첫 줄에 뜬 적이 있다.
 *   ⚠ 오늘 0건이면 최근 3일로 넓히고, 넓혔다는 사실을 화면에 적는다. 속이지 않는다.
 *
 * 2026-09-04 개편(4차)
 *   ⚠ 「기타」 탭을 없앴다. 자동 수집 스크립트 4개(collect-bizinfo·collect-kstartup·
 *     collect-iris·collect-ntis)가 만드는 출처는 기업마당·K-Startup·IRIS·NTIS 뿐이다.
 *     `출처='공고문'` 인 예외가 DB에 하나 있었는데, 그건 어제 규칙 엔진 시연용으로
 *     수동 삽입된 단일 레코드였고 오늘은 신규로도 안 잡힌다(실측). 자동 수집만으로는
 *     이 탭이 채워질 길이 없어 걷어냈다.
 *   ⚠ **목록 자체를 자격판정 「가능」만 걸러서 보여준다.** 「가능만」 토글(버튼)만 없앤
 *     것이지 필터 자체를 없앤 게 아니다 — 이 카드는 원래부터 「지원 가능한 것만
 *     본다」는 게 목적이었다. 「불가·확인필요·요건미확인」은 이 카드에 아예 안 나온다.
 *     전부(판정 무관) 보고 싶거나 자세히 다시 거르고 싶으면 **탭별 「전체 공고 확인」**
 *     링크로 탐색 화면(자사기준만·자격판정 드롭다운이 이미 있다)으로 보낸다.
 *     탭에 따라 목적지가 갈린다(과제→과제 탐색, 지원사업→지원사업 탐색).
 *   ⚠ 탭 옆 숫자·헤더의 건수는 모두 **가능 판정 기준**이다. 「지원사업 180」처럼
 *     전체 건수를 보여주면 목록엔 몇 줄 안 보이는데 탭엔 큰 수가 찍혀 앞뒤가 안 맞는다.
 *   ⚠ 하단의 건수 텍스트를 지웠다 — 탭 옆 숫자와 같은 걸 두 번 말하고 있었다.
 *     페이지 위치(‹ n/m ›)만 남긴다.
 */

const 페이지당 = 5

const 탭목록 = ["과제", "지원사업"] as const
type Tab = (typeof 탭목록)[number]

/** 두 탭 중 어디에도 안 걸리는 출처는 자동 수집 경로 밖이라 어느 탭에도 안 세운다. */
const 탭구분 = (출처: string): Tab | null => {
  if (출처 === "기업마당" || 출처 === "K-Startup") return "지원사업"
  if (출처 === "IRIS" || 출처 === "NTIS") return "과제"
  return null
}

/** 과제 공고는 공고 탐색이 따로 있다. 탭에 따라 상세 경로가 갈린다. */
const 상세경로 = (탭: Tab, id: number) =>
  탭 === "과제" ? `/project-announcements/${id}` : `/announcements/${id}`
const 목록경로 = (탭: Tab) => (탭 === "과제" ? "/project-announcements" : "/announcements")

export type 자격판정값 = "가능" | "불가" | "확인필요" | "요건미확인" | "해당없음"

export function AnnouncementBoard({
  rows,
  판정,
  undated,
  today,
  error,
}: {
  rows: BoardRow[]
  /** id → 자격판정. `/announcements`·`/project-announcements` 가 쓰는 것과 같은 값. */
  판정: Record<number, 자격판정값 | undefined>
  /** 관심 표시했는데 마감이 날짜가 아닌 공고(상시·소진시). 버리면 조용히 사라진다. */
  undated: UndatedRow[]
  /** 「오늘」은 서버가 정한다. 심사장 PC 시계를 믿지 않는다. */
  today: string
  error?: string | null
}) {
  // ① 이미 끝난 공고는 새로 올라왔든 말든 뺀다. 할 수 있는 게 없다.
  // ② 자격판정이 「가능」인 것만 이 카드에 올린다 — 원래 목적이 그거였다.
  const 가능한것 = React.useMemo(
    () => rows.filter((r) => !(r.d_day != null && r.d_day < 0) && 판정[r.id] === "가능"),
    [rows, 판정],
  )

  // ③ 오늘 것이 없으면 최근 3일. 넓혔다는 사실을 화면에 적는다.
  const { 대상, 넓힘 } = React.useMemo(() => {
    const 오늘것 = 가능한것.filter((r) => r.신규)
    if (오늘것.length > 0) return { 대상: 오늘것, 넓힘: false }
    const 사흘전 = 더하기(today, -3)
    const 최근 = 가능한것.filter((r) => r.기준일 != null && r.기준일 >= 사흘전)
    return { 대상: 최근, 넓힘: 최근.length > 0 }
  }, [가능한것, today])

  const [active, set액티브] = React.useState<Tab>("지원사업")
  const [page, set페이지] = React.useState(0)

  const 탭전환 = (t: Tab) => {
    set액티브(t)
    set페이지(0)
  }

  const 개수 = React.useMemo(() => {
    const m = new Map<Tab, number>()
    for (const t of 탭목록) m.set(t, 0)
    for (const r of 대상) {
      const t = 탭구분(r.출처)
      if (t) m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [대상])

  const 탭전체행 = React.useMemo(
    () => 대상.filter((r) => 탭구분(r.출처) === active),
    [대상, active],
  )
  const 총페이지 = Math.max(1, Math.ceil(탭전체행.length / 페이지당))
  const 현재페이지 = Math.min(page, 총페이지 - 1)
  const 보이는행 = 탭전체행.slice(현재페이지 * 페이지당, 현재페이지 * 페이지당 + 페이지당)

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline gap-2 border-b px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Megaphone className="size-3.5" />
        </span>
        <h2 className="text-sm font-semibold">공고 확인</h2>
        <span className="text-xs text-muted-foreground">
          {error
            ? "불러오지 못했습니다"
            : 대상.length === 0
              ? "새로 올라온 가능 판정 공고 없음"
              : 넓힘
                ? `최근 3일에 올라온 가능 판정 공고 ${대상.length}건 — 오늘 새로 올라온 것은 없습니다`
                : `오늘 새로 올라온 가능 판정 공고 ${대상.length}건`}
        </span>
      </div>

      {error ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          공고를 불러오지 못했습니다.
          <span className="mt-1 block text-xs opacity-70">{error}</span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2">
            <div role="tablist" aria-label="공고 구분" className="flex gap-1">
              {탭목록.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === active}
                  onClick={() => 탭전환(t)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                    t === active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {개수.get(t) ?? 0}
                  </span>
                </button>
              ))}
            </div>

            {/* 탭에 따라 갈 곳이 다르다 — 과제는 과제 탐색, 지원사업은 지원사업 탐색.
                판정을 더 자세히 거르고 싶으면(자사기준만·자격판정 필터) 여기가 아니라 탐색에서 한다. */}
            <Link
              href={목록경로(active)}
              className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              전체 공고 확인 →
            </Link>
          </div>

          {탭전체행.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              오늘 새로 올라온 가능 판정 {active} 공고가 없습니다
              <span className="mt-1 block text-xs opacity-70">
                판정 무관 전체는 위 「전체 공고 확인」에서 본다
              </span>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8" title="관심 표시하면 마감일이 달력에 뜬다">
                    <span className="sr-only">관심</span>★
                  </TableHead>
                  <TableHead>사업명</TableHead>
                  <TableHead className="w-[170px]">기관</TableHead>
                  <TableHead className="w-[200px]">접수기간</TableHead>
                  <TableHead className="w-[80px]">출처</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {보이는행.map((r) => (
                  <TableRow key={r.id} className="h-[38px] text-[13px]">
                    <TableCell className="pr-0">
                      <WatchStar id={r.id} on={r.관심} />
                    </TableCell>
                    {/* max-w + min-w-0 이 없으면 truncate 가 안 먹고 표가 가로로 밀린다 */}
                    <TableCell className="max-w-[1px] font-medium">
                      <Link
                        href={상세경로(active, r.id)}
                        className="flex min-w-0 items-center gap-1.5 hover:underline"
                        title={r.사업명}
                      >
                        <판정배지 값={판정[r.id]} />
                        <span className="truncate">{r.사업명}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[1px] truncate text-muted-foreground">
                      {r.기관 ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      <Period row={r} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.출처}</TableCell>
                  </TableRow>
                ))}
                {/* 줄 수를 고정한다. 마지막 페이지가 짧다고 카드 키가 흔들리면 아래 카드가 움직인다. */}
                {Array.from({ length: 페이지당 - 보이는행.length }).map((_, i) => (
                  <TableRow key={`filler-${i}`} aria-hidden className="h-[38px]">
                    <TableCell colSpan={5} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* 관심 공고인데 마감이 날짜가 아닌 것. 달력에 못 올라가므로 여기서 받는다. */}
          {undated.length > 0 && (
            <div className="border-t px-4 py-2">
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                날짜 미정 {undated.length}건
              </h3>
              <ul className="space-y-0.5">
                {undated.slice(0, 3).map((u) => (
                  <li key={u.참조키}>
                    <Link
                      href={u.링크}
                      className="flex items-center gap-2 rounded py-0.5 text-[13px] hover:underline"
                    >
                      <span className="min-w-0 flex-1 truncate">{u.제목}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{u.사유}</span>
                    </Link>
                  </li>
                ))}
                {undated.length > 3 && (
                  <li className="text-xs text-muted-foreground">외 {undated.length - 3}건</li>
                )}
              </ul>
            </div>
          )}

          {/* 건수는 탭 옆 숫자와 겹친다 — 여기서는 페이지 위치만 말한다. */}
          {총페이지 > 1 && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
              <button
                type="button"
                disabled={현재페이지 === 0}
                onClick={() => set페이지((p) => p - 1)}
                aria-label="이전 페이지"
                className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                ‹
              </button>
              <span className="tabular-nums">
                {현재페이지 + 1} / {총페이지}
              </span>
              <button
                type="button"
                disabled={현재페이지 >= 총페이지 - 1}
                onClick={() => set페이지((p) => p + 1)}
                aria-label="다음 페이지"
                className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 자격판정 배지 — 공고 탐색과 같은 값을 같은 뜻으로 보여준다. 판정이 없으면 아무것도 안 그린다. */
function 판정배지({ 값 }: { 값?: 자격판정값 }) {
  if (!값) return null
  const 스타일: Record<자격판정값, string> = {
    가능: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    불가: "border-muted-foreground/30 bg-muted text-muted-foreground",
    확인필요: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    요건미확인: "border-border text-muted-foreground/70",
    해당없음: "border-border text-muted-foreground/70",
  }
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-none",
        스타일[값],
      )}
    >
      {값}
    </span>
  )
}

/** 날짜 문자열에 일수를 더한다. UTC 로 계산해 시간대에 따라 하루가 밀리는 것을 막는다. */
function 더하기(s: string, n: number) {
  const [y, m, d] = s.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  const p = (x: number) => String(x).padStart(2, "0")
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

/**
 * 관심 표시 별.
 * 누르면 그 공고의 마감일이 달력에 파란색으로 올라간다 — 이 화면과 달력을 잇는 유일한 고리다.
 * ⚠ 실패하면 조용히 넘어가지 않는다. 별이 붉게 남고 이유가 툴팁에 붙는다.
 */
function WatchStar({ id, on }: { id: number; on: boolean }) {
  const [대기, 시작] = React.useTransition()
  const [오류, set오류] = React.useState<string | null>(null)

  return (
    <button
      type="button"
      disabled={대기}
      aria-pressed={on}
      aria-label={on ? "관심 해제" : "관심 표시"}
      title={오류 ?? (on ? "관심 해제" : "관심 표시 — 마감일이 달력에 뜬다")}
      onClick={() =>
        시작(async () => {
          const r = await toggleWatch("공고", id, !on)
          set오류(r.ok ? null : (r.error ?? "관심 표시를 저장하지 못했습니다"))
        })
      }
      className={cn(
        "rounded px-0.5 text-base leading-none transition-colors disabled:opacity-50",
        오류
          ? "text-destructive"
          : on
            ? "text-blue-500 hover:text-blue-600"
            : "text-muted-foreground/40 hover:text-muted-foreground",
      )}
    >
      {오류 ? "!" : on ? "★" : "☆"}
    </button>
  )
}

/**
 * 접수기간.
 * 실측으로 접수기간의 56%가 날짜가 아니다(상시·소진시·선착순·상이).
 * 날짜가 없으면 마감유형을 그대로 보여준다. **날짜를 지어내지 않는다.**
 */
function Period({ row }: { row: BoardRow }) {
  if (!row.접수종료) {
    return (
      <span className="text-xs opacity-60">
        {row.마감유형 === "dated" ? "확인 필요" : row.마감유형}
      </span>
    )
  }
  const d = row.d_day
  return (
    <span>
      {row.접수시작 ? `${row.접수시작} ~ ` : "~ "}
      {row.접수종료}
      {d != null && (
        <span
          className={cn(
            "ml-1.5 text-xs",
            d <= 7
              ? "text-destructive"
              : d <= 30
                ? "text-[var(--warning-fg)]"
                : "text-muted-foreground",
          )}
        >
          D-{d}
        </span>
      )}
    </span>
  )
}
