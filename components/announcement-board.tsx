"use client"

import * as React from "react"
import Link from "next/link"
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
 * 케이오시 현안 1번이 「매일 여러 기관 홈페이지를 확인해 엑셀에 수기 정리」다.
 * 그 사람이 아침에 알고 싶은 건 딱 하나다 — **어제 없던 게 뭐냐.**
 *
 * 2026-09-03 개편(2차)
 *   ① **이미 마감된 공고를 뺀다.** `신규`는 「오늘 게시됐거나 오늘 수집됨」이라
 *      **접수기간이 지난 공고도 신규로 잡힌다.** 실제로 「2026-03-03 마감」짜리가
 *      NEW 를 달고 첫 줄에 있었다. 대시보드 첫 줄이 끝난 공고면 안 된다.
 *   ② **오늘 0건이면 최근 3일로 넓힌다.** 수집이 안 도는 날 첫 카드가 통째로 비면
 *      「고장났다」로 보인다. 넓혔을 때는 그렇다고 화면에 적는다 — 속이지 않는다.
 *   ③ **NEW 배지를 뗐다.** 전부 새 공고라 줄마다 붙으면 아무것도 구분하지 못한다.
 *   ④ **탭마다 5줄.** 그 아래 카드들이 화면 밖으로 밀리지 않게.
 *   ⑤ **사업명을 누르면 공고 상세로 간다.** 탭에 따라 갈린다 —
 *      과제는 `/project-announcements/[id]`, 나머지는 `/announcements/[id]`.
 *      공고 탐색 화면이 둘로 나뉘어 있어서 목적지도 둘이다.
 *   ⑥ **「전체 보기」 링크는 아래 하나뿐이다.** 머리에도 두면 같은 링크가 두 번 나온다.
 *      탭이 비면 링크가 같이 사라지므로 **빈 안내문이 링크를 문다.**
 *
 * ⚠ 탭 목록을 코드에 박지 않는다. 행의 `구분`(= funding_schemes.대분류)에서 만든다.
 *   다만 **0건인 탭은 세우지 않는다** — 빈 탭은 「없다」가 아니라 「고장났다」로 읽힌다.
 * ⚠ 화면에 쓰는 이름만 바꾼다. 「미분류」는 DB 값이고 사용자에겐 「기타」로 보인다.
 */

const 보이는이름: Record<string, string> = { 미분류: "기타" }
const 이름 = (구분: string) => 보이는이름[구분] ?? 구분

/** 과제 공고는 공고 탐색이 따로 있다. 탭에 따라 상세 경로가 갈린다. */
const 상세경로 = (구분: string, id: number) =>
  구분 === "과제" ? `/project-announcements/${id}` : `/announcements/${id}`
const 목록경로 = (구분: string) =>
  구분 === "과제" ? "/project-announcements" : "/announcements"

export function AnnouncementBoard({
  rows,
  undated,
  today,
  최대 = 5,
  error,
}: {
  rows: BoardRow[]
  /** 관심 표시했는데 마감이 날짜가 아닌 공고(상시·소진시). 버리면 조용히 사라진다. */
  undated: UndatedRow[]
  /** 「오늘」은 서버가 정한다. 심사장 PC 시계를 믿지 않는다. */
  today: string
  최대?: number
  error?: string | null
}) {
  // ① 이미 끝난 공고는 새로 올라왔든 말든 뺀다. 할 수 있는 게 없다.
  const 열린것 = React.useMemo(
    () => rows.filter((r) => !(r.d_day != null && r.d_day < 0)),
    [rows],
  )

  // ② 오늘 것이 없으면 최근 3일. 넓혔다는 사실을 화면에 적는다.
  const { 대상, 넓힘 } = React.useMemo(() => {
    const 오늘것 = 열린것.filter((r) => r.신규)
    if (오늘것.length > 0) return { 대상: 오늘것, 넓힘: false }
    const 사흘전 = 더하기(today, -3)
    const 최근 = 열린것.filter((r) => r.기준일 != null && r.기준일 >= 사흘전)
    return { 대상: 최근, 넓힘: 최근.length > 0 }
  }, [열린것, today])

  // 0건인 탭은 세우지 않는다.
  const 탭 = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of 대상) m.set(r.구분, (m.get(r.구분) ?? 0) + 1)
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([구분, n]) => ({ 구분, n }))
  }, [대상])

  const [active, setActive] = React.useState<string | null>(null)
  const 현재 = active && 탭.some((t) => t.구분 === active) ? active : (탭[0]?.구분 ?? null)

  const 전체행 = 현재 ? 대상.filter((r) => r.구분 === 현재) : []
  const 보이는행 = 전체행.slice(0, 최대)

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">공고 확인</h2>
        <span className="text-xs text-muted-foreground">
          {error
            ? "불러오지 못했습니다"
            : 대상.length === 0
              ? "새로 올라온 공고 없음"
              : 넓힘
                ? `최근 3일에 올라온 공고 ${대상.length}건 — 오늘 새로 올라온 것은 없습니다`
                : `오늘 새로 올라온 공고 ${대상.length}건`}
        </span>
      </div>

      {error ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          공고를 불러오지 못했습니다.
          <span className="mt-1 block text-xs opacity-70">{error}</span>
        </p>
      ) : 탭.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          최근 3일 안에 새로 올라온 공고가 없습니다 ·{" "}
          <Link href="/announcements" className="text-primary hover:underline">
            공고 탐색에서 전체 보기
          </Link>
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="공고 구분" className="flex gap-1 border-b px-2">
            {탭.map(({ 구분, n }) => (
              <button
                key={구분}
                type="button"
                role="tab"
                aria-selected={구분 === 현재}
                onClick={() => setActive(구분)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                  구분 === 현재
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {이름(구분)}
                <span className="tabular-nums text-xs text-muted-foreground">{n}</span>
              </button>
            ))}
          </div>

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
                      href={상세경로(r.구분, r.id)}
                      className="block truncate hover:underline"
                      title={r.사업명}
                    >
                      {r.사업명}
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
            </TableBody>
          </Table>

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
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {u.사유}
                      </span>
                    </Link>
                  </li>
                ))}
                {undated.length > 3 && (
                  <li className="text-xs text-muted-foreground">
                    외 {undated.length - 3}건
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {전체행.length > 보이는행.length && (
              <>외 {전체행.length - 보이는행.length}건 · </>
            )}
            <Link
              href={현재 ? 목록경로(현재) : "/announcements"}
              className="text-primary hover:underline"
            >
              공고 탐색에서 전체 보기
            </Link>
          </div>
        </>
      )}
    </div>
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
