"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/page-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toggleWatch } from "@/app/actions/watchlist"
import type { BoardRow } from "@/lib/queries"

/**
 * 공고 확인 보드 — 과제 / 지원사업을 탭으로 가른다.
 *
 * 케이오시 현안 1번이 「매일 여러 기관 홈페이지를 확인해 엑셀에 수기 정리」다.
 * 그 사람이 아침에 이 화면을 열어서 알고 싶은 것은 딱 하나다 — **어제 없던 게 뭐냐.**
 * 그래서 NEW 가 배지가 아니라 이 화면의 목적이다.
 *
 * ⚠ 탭 목록을 코드에 박지 않는다. 행의 `구분`(= funding_schemes.대분류)에서 만든다.
 *   사업유형이 늘어나면 DB 한 칸만 채우면 탭이 따라온다.
 * ⚠ 「미분류」 탭은 있을 때만 보여준다. 오픈 API 는 사업유형을 주지 않으므로
 *   수집한 공고 대부분이 여기로 온다 — 숨기면 공고가 사라진 것처럼 보인다.
 */

const 기본탭 = ["과제", "지원사업"] as const

export function AnnouncementBoard({
  rows,
  최대,
}: {
  rows: BoardRow[]
  /** 대시보드처럼 좁은 자리에서는 앞의 몇 건만. 안 주면 전부 그린다. */
  최대?: number
}) {
  // 기본 두 탭은 비어 있어도 항상 세운다. 「지원사업이 0건」과 「지원사업 탭이 없음」은 다르다.
  const 탭 = React.useMemo(() => {
    const 있는구분 = new Set(rows.map((r) => r.구분))
    const 추가 = [...있는구분].filter(
      (g) => !기본탭.includes(g as (typeof 기본탭)[number]),
    )
    return [...기본탭, ...추가.sort()]
  }, [rows])

  const [active, setActive] = React.useState<string>(기본탭[0])

  const 개수 = React.useMemo(() => {
    const m = new Map<string, { 전체: number; 신규: number }>()
    for (const t of 탭) m.set(t, { 전체: 0, 신규: 0 })
    for (const r of rows) {
      const c = m.get(r.구분)
      if (!c) continue
      c.전체 += 1
      if (r.신규) c.신규 += 1
    }
    return m
  }, [rows, 탭])

  const 전체행 = rows.filter((r) => r.구분 === active)
  // 대시보드는 「오늘 손댈 것」을 보는 자리다. 27줄짜리 표를 그리면 그 아래 큐가 화면 밖으로 밀린다.
  const 보이는행 = 최대 ? 전체행.slice(0, 최대) : 전체행
  const 신규합 = rows.filter((r) => r.신규).length

  // NEW 가 몇 줄만 있으면 배지가 눈에 띄지만, 줄마다 붙으면 아무것도 구분하지 못한다.
  // 3건부터는 배지를 떼고 구분선 하나로 묶는다. 행이 기준일 내림차순이라 신규가 위에 모인다.
  // ⚠ 건수는 잘라내기 전(전체행) 기준이다. 보이는 8줄만 세면 「16건 중 8건」을 8건이라 말하게 된다.
  const 신규수 = 전체행.filter((r) => r.신규).length
  const 묶기 = 신규수 >= 3

  return (
    <div className="rounded-lg border bg-card">
      {/* 머리 — 오늘 새로 올라온 것의 총합을 먼저 말한다 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">공고 확인</h2>
          <span className="text-xs text-muted-foreground">
            {신규합 > 0 ? (
              <>
                오늘 새로 올라온 공고{" "}
                <b className="text-[var(--warning-fg)]">{신규합}건</b>
              </>
            ) : (
              "오늘 새로 올라온 공고 없음"
            )}
          </span>
        </div>
        <Link
          href="/announcements"
          className="text-xs text-primary hover:underline"
        >
          공고 탐색 전체
        </Link>
      </div>

      {/* 탭 */}
      <div role="tablist" aria-label="공고 구분" className="flex gap-1 border-b px-2">
        {탭.map((t) => {
          const c = 개수.get(t) ?? { 전체: 0, 신규: 0 }
          const on = t === active
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                on
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
              <span className="tabular-nums text-xs text-muted-foreground">
                {c.전체}
              </span>
              {c.신규 > 0 && (
                <span className="inline-flex h-4 items-center rounded-4xl bg-[var(--warning)] px-1.5 text-[10px] font-semibold text-[var(--warning-fg)]">
                  +{c.신규}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {보이는행.length === 0 ? (
        <EmptyState
          title={`${active} 공고가 없습니다`}
          hint={
            active === "미분류"
              ? "사업유형이 비어 있는 공고가 여기 모입니다."
              : "오픈 API 수집분은 사업유형이 비어 있어 「미분류」로 들어갑니다. 확정한 건만 이 탭으로 옵니다."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" title="관심 표시하면 마감일이 달력에 뜬다">
                <span className="sr-only">관심</span>★
              </TableHead>
              <TableHead>사업명</TableHead>
              <TableHead className="w-[180px]">기관</TableHead>
              <TableHead className="w-[210px]">접수기간</TableHead>
              <TableHead className="w-[84px]">출처</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {보이는행.map((r, i) => (
              <React.Fragment key={r.id}>
                {묶기 && i === 0 && r.신규 && (
                  <GroupRow label={`오늘 새로 올라온 공고 ${신규수}건`} 강조 />
                )}
                {묶기 && i > 0 && 보이는행[i - 1].신규 && !r.신규 && (
                  <GroupRow label="이전" />
                )}
                <TableRow className="h-[38px] text-[13px]">
                  <TableCell className="pr-0">
                    <WatchStar id={r.id} on={r.관심} />
                  </TableCell>
                  {/* max-w + min-w-0 이 없으면 truncate 가 안 먹고 표가 가로로 밀린다 */}
                  <TableCell className="max-w-[1px] font-medium">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {!묶기 && r.신규 && <NewBadge 날짜출처={r.날짜출처} />}
                      <span className="truncate" title={r.사업명}>
                        {r.사업명}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[1px] truncate text-muted-foreground">
                    {r.기관 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    <Period row={r} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.출처}</TableCell>
                </TableRow>
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {전체행.length > 보이는행.length && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          외 {전체행.length - 보이는행.length}건 ·{" "}
          <Link href="/announcements" className="text-primary hover:underline">
            공고 탐색에서 전체 보기
          </Link>
        </div>
      )}
    </div>
  )
}

/** 구분선 행. NEW 배지를 줄마다 붙이는 대신 한 번만 말한다. */
function GroupRow({ label, 강조 }: { label: string; 강조?: boolean }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={5}
        className={cn(
          "h-6 py-1 text-xs",
          강조 ? "text-[var(--warning-fg)]" : "text-muted-foreground",
        )}
      >
        {label}
      </TableCell>
    </TableRow>
  )
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
 * NEW 배지.
 * ⚠ 공고일을 API 가 안 주면 「우리가 오늘 수집했다」는 뜻이다. 둘은 다른 사실이라
 *   툴팁으로 구분해 둔다. 「오늘 게시」인 척하지 않는다.
 */
function NewBadge({ 날짜출처 }: { 날짜출처: string }) {
  const 수집 = 날짜출처 === "수집일"
  return (
    <span
      title={
        수집
          ? "오늘 수집됨 — 공고일을 제공하지 않는 출처라 수집일 기준이다"
          : "오늘 게시된 공고"
      }
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-4xl px-1.5",
        "text-[10px] font-semibold tracking-wide",
        "bg-[var(--warning)] text-[var(--warning-fg)]",
      )}
    >
      NEW
    </span>
  )
}

/**
 * 접수기간.
 * 실측으로 접수기간의 56%가 날짜가 아니다(상시·소진시·선착순·상이).
 * 날짜가 없으면 마감유형을 그대로 보여준다. **날짜를 지어내지 않는다.**
 */
function Period({ row }: { row: BoardRow }) {
  if (!row.접수종료) {
    // 「상시」·「정보성」 같은 값은 날짜가 아니다. 날짜와 같은 무게로 보이면 표가 시끄러워진다.
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
            d < 0
              ? "text-muted-foreground"
              : d <= 7
                ? "text-destructive"
                : d <= 30
                  ? "text-[var(--warning-fg)]"
                  : "text-muted-foreground",
          )}
        >
          {d < 0 ? "마감" : `D-${d}`}
        </span>
      )}
    </span>
  )
}
