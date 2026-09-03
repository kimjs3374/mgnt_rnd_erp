"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ProjectRow } from "@/lib/queries"

/**
 * 수행 과제/사업 — 지금 우리가 하고 있는 것.
 *
 * 왜 대시보드에 두나: 「내가 무슨 사업을 하고 있더라」를 보려고 메뉴를 두 번 눌러
 * 들어가야 하는 게 이상하다. 제목만이라도 여기서 보이고, 누르면 바로 상세로 간다.
 *
 * ⚠ 탭을 「과제 / 사업」으로 나누지 않는다. 실측(2026-09-03) 결과 `projects` 12건이
 *   **전부 `NATIONAL_RND`(과제)** 라 「사업」 탭이 0건이 된다. 공고 확인의 「지원사업 0」과
 *   똑같은 그림이 반복될 뿐이다. 상태(수행중·신청중)로 나누는 편이 실제로 정보가 있다.
 * ⚠ `종료`는 대시보드에 올리지 않는다. 보고 나서 할 일이 없다.
 */

const 탭순서 = ["수행중", "신청중"]

export function ProjectBoard({
  rows,
  최대 = 5,
  error,
}: {
  rows: ProjectRow[]
  최대?: number
  error?: string | null
}) {
  const 대상 = React.useMemo(
    () => rows.filter((r) => r.상태 !== "종료"),
    [rows],
  )

  // 0건인 탭은 세우지 않는다. 빈 탭은 「없다」가 아니라 「고장났다」로 읽힌다.
  const 탭 = React.useMemo(() => {
    const 있는 = new Set(대상.map((r) => r.상태))
    return [
      ...탭순서.filter((t) => 있는.has(t)),
      ...[...있는].filter((t) => !탭순서.includes(t)).sort(),
    ]
  }, [대상])

  const [active, setActive] = React.useState<string | null>(null)
  const 현재 = active && 탭.includes(active) ? active : (탭[0] ?? null)

  const 전체행 = 대상.filter((r) => r.상태 === 현재)
  const 보이는행 = 전체행.slice(0, 최대)

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">수행 과제·사업</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {대상.length}건
        </span>
      </div>

      {error ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          목록을 불러오지 못했습니다.
          <span className="mt-1 block text-xs opacity-70">{error}</span>
        </p>
      ) : 탭.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          수행 중인 과제가 없습니다 ·{" "}
          <Link href="/projects" className="text-primary hover:underline">
            사업 대장에서 전체 보기
          </Link>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="상태" className="flex gap-1 border-b px-2">
            {탭.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === 현재}
                onClick={() => setActive(t)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                  t === 현재
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
                <span className="tabular-nums text-xs text-muted-foreground">
                  {대상.filter((r) => r.상태 === t).length}
                </span>
              </button>
            ))}
          </div>

          <ul className="flex-1 p-2">
            {보이는행.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/projects/${r.id}`}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]" title={r.과제명}>
                      {r.과제명}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.부처 ?? r.전문기관 ?? "기관 미상"}
                      {r.연차 != null && ` · ${r.연차}차년도`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* 링크는 여기 하나뿐이다. 머리에도 두면 같은 링크가 두 번 나온다. */}
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {전체행.length > 보이는행.length && (
              <>외 {전체행.length - 보이는행.length}건 · </>
            )}
            <Link href="/projects" className="text-primary hover:underline">
              사업 대장에서 전체 보기
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
