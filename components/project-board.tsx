"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ProjectRow } from "@/lib/queries"
import { 단계정의, 단계판정, 미선정인가, type 과제단계 } from "@/lib/project-stage"

/**
 * 과제 관리 — 지금 우리가 하고 있는 것.
 *
 * 왜 대시보드에 두나: 「내가 무슨 사업을 하고 있더라」를 보려고 메뉴를 두 번 눌러
 * 들어가야 하는 게 이상하다. 제목만이라도 여기서 보이고, 누르면 바로 상세로 간다.
 *
 * 2026-09-04 개편(3차)
 *   ⚠ **저장된 `상태` 대신 `lib/project-stage.ts` 의 `단계판정()` 을 쓴다.**
 *     사이드바 「과제 관리」(신청중·수행중·사업종료, 오늘 사용자 지시로 만들어짐)가
 *     이 함수로 단계를 계산한다 — 저장값만 보면 수행기간이 지나도 저절로 안 넘어간다.
 *     예전엔 `r.상태` 를 그대로 썼는데, 그러면 이 카드에 뜬 항목이 실제
 *     `/projects/applying`·`/projects/closed` 에는 없는 어긋남이 생길 수 있었다.
 *   ⚠ **미선정 건은 뺀다.** 세 단계 어디에도 안 넣는다 — 과제가 되지 못한 건이라
 *     지원사업 대장(`/programs`)에서 「왜 떨어졌나」와 함께 보는 게 맞다.
 *   ⚠ **탭 순서·경로는 `단계정의` 하나에서 가져온다.** 사이드바와 다른 순서·다른 주소를
 *     쓰면 같은 개념을 두 군데서 다르게 말하게 된다.
 *   ⚠ **사업유형(과제/지원사업) 배지를 붙인다.** 실측(2026-09-03) 결과 지금 데이터는
 *     전부 `NATIONAL_RND`(과제)라 지금은 다 같은 배지지만, 지자체 사업이 들어오면
 *     바로 값이 생긴다 — 미리 넣어 둔다.
 *   ⚠ **D-day 를 뺐다.** 종료일은 이미 일정(달력) 카드에 「사업종료」로 올라가고,
 *     30일 이내면 거기서 강조된다. 같은 숫자를 두 카드에서 다른 모양으로 보여줄
 *     이유가 없고, 이 카드의 몫은 「언제까지가 아니라 무엇을 하고 있나」다.
 *     날짜는 남기되 **연도까지 다 쓴다** — 월.일만 쓰면 2년 뒤 것과 헷갈린다.
 *   ⚠ **「외 N건」 대신 페이지 넘김.**
 *
 * 2026-09-04 개편(4차) — 「카드가 쓸데없이 크다」는 지적으로 페이지당 8줄 → **3줄**.
 *   줄어든 높이만큼 옆(사실은 아래)에 「오늘 처리할 것」 카드가 새로 생겨 그 자리를
 *   메운다 — 이 카드가 다시 커질 이유는 없다. 옆 달력 카드와 세로를 맞추는 일은
 *   이제 이 카드 혼자가 아니라 **이 카드 + 오늘 처리할 것을 합친 오른쪽 열** 이 한다
 *   (`app/(app)/dashboard/page.tsx` 참고 — 오른쪽 열을 flex-col 로 묶고 오늘 처리할
 *   것에 flex-1 을 준다).
 */

// 사업종료는 대시보드에 안 올린다 — 보고 나서 할 일이 없다. 순서는 단계정의(신청→수행→종료)를 따른다.
// ⚠ 타입을 명시한다 — TS 가 `!== "사업종료"` 필터에서 타입을 좁혀 버리면
//   아래에서 「과제단계 | null」 인 active 를 못 받아들인다.
const 탭목록: 과제단계[] = 단계정의.map((d) => d.단계).filter((t) => t !== "사업종료")
const 페이지당 = 3

const 사업유형이름: Record<string, string> = {
  NATIONAL_RND: "과제",
  LOCAL_TP: "지원사업",
}

/** projects.select("*") 가 실제로 주는데 ProjectRow 타입 선언엔 없는 필드.
 *  타입만 넓히는 것이라 lib/queries.ts 를 고칠 필요가 없다. */
type ProjectRowExt = ProjectRow & { 선정결과?: string | null }

export function ProjectBoard({
  rows,
  today,
  error,
}: {
  rows: ProjectRow[]
  /** 「오늘」은 서버가 정한다. 심사장 PC 시계를 믿지 않는다. */
  today: string
  error?: string | null
}) {
  const 대상 = React.useMemo(() => {
    const ext = rows as ProjectRowExt[]
    return ext
      .filter((r) => !미선정인가(r))
      .map((r) => ({ row: r, 단계: 단계판정(r, today) }))
      .filter((x) => x.단계 !== "사업종료")
  }, [rows, today])

  // 0건인 탭은 세우지 않는다. 빈 탭은 「없다」가 아니라 「고장났다」로 읽힌다.
  const 탭 = React.useMemo(() => {
    const 있는 = new Set(대상.map((x) => x.단계))
    return 탭목록.filter((t) => 있는.has(t))
  }, [대상])

  const [active, setActive] = React.useState<과제단계 | null>(null)
  const [page, set페이지] = React.useState(0)
  const 현재 = active && 탭.includes(active) ? active : (탭[0] ?? null)

  const 탭전환 = (t: 과제단계) => {
    setActive(t)
    set페이지(0)
  }

  const 전체행 = React.useMemo(
    () => 대상.filter((x) => x.단계 === 현재).map((x) => x.row),
    [대상, 현재],
  )
  const 총페이지 = Math.max(1, Math.ceil(전체행.length / 페이지당))
  const 현재페이지 = Math.min(page, 총페이지 - 1)
  const 보이는행 = 전체행.slice(현재페이지 * 페이지당, 현재페이지 * 페이지당 + 페이지당)

  const 단계경로_ = (t: 과제단계) => 단계정의.find((d) => d.단계 === t)?.경로 ?? "/projects"

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">과제 관리</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{대상.length}건</span>
      </div>

      {error ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          목록을 불러오지 못했습니다.
          <span className="mt-1 block text-xs opacity-70">{error}</span>
        </p>
      ) : 탭.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          진행 중인 과제가 없습니다 ·{" "}
          <Link href="/projects" className="text-primary hover:underline">
            과제 관리에서 전체 보기
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2">
            <div role="tablist" aria-label="단계" className="flex gap-1">
              {탭.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === 현재}
                  onClick={() => 탭전환(t)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                    t === 현재
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {대상.filter((x) => x.단계 === t).length}
                  </span>
                </button>
              ))}
            </div>

            {현재 && (
              <Link
                href={단계경로_(현재)}
                className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                전체 보기 →
              </Link>
            )}
          </div>

          <ul className="flex-1 divide-y">
            {보이는행.map((r) => (
              <li key={r.id} className="h-[52px]">
                <Link
                  href={`/projects/${r.id}`}
                  className="flex h-full items-center gap-3 px-2 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <사업유형배지 코드={r.사업유형} />
                      <span className="truncate text-[13px]" title={r.과제명}>
                        {r.과제명}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.부처 ?? r.전문기관 ?? "기관 미상"}
                      {r.연차 != null && ` · ${r.연차}차년도`}
                    </span>
                  </span>
                  <날짜꼬리 row={r} 단계={현재} />
                </Link>
              </li>
            ))}
            {/* 줄 수를 고정한다. 옆 달력 카드보다 짧아서 빈 자리가 남던 것을 없앤다. */}
            {Array.from({ length: 페이지당 - 보이는행.length }).map((_, i) => (
              <li key={`filler-${i}`} aria-hidden className="h-[52px]" />
            ))}
          </ul>

          {/* 페이지가 하나뿐이어도 이 줄은 항상 그린다("1 / 1") — 신청중(1p)·수행중(2p)을
              오갈 때 이 줄이 있다 없다 하면 카드 높이가 탭마다 바뀐다(2026-09-04 지적). */}
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
        </>
      )}
    </div>
  )
}

/** 과제/지원사업 — 지금은 다 같은 값이지만 지자체 사업이 들어오면 갈린다. */
function 사업유형배지({ 코드 }: { 코드: string | null }) {
  if (!코드) return null
  const 이름 = 사업유형이름[코드] ?? 코드
  return (
    <span className="inline-flex h-4 shrink-0 items-center rounded border border-border px-1 text-[10px] font-medium text-muted-foreground">
      {이름}
    </span>
  )
}

/**
 * 오른쪽 날짜 열.
 * 신청중은 아직 협약 전이라 종료일이 의미 없다 — 시작 예정일로 보여준다.
 * 수행중·사업종료는 종료일(연도 포함, 전체) 을 보여준다. D-day 는 없다 —
 * 마감 임박은 일정(달력) 카드가 담당한다.
 */
function 날짜꼬리({ row, 단계 }: { row: ProjectRow; 단계: 과제단계 | null }) {
  if (단계 === "신청중") {
    if (!row.시작일) return null
    return (
      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        시작 예정
        <br />
        {row.시작일}
      </span>
    )
  }

  if (!row.종료일) return null
  const 라벨 = row.사업유형 === "LOCAL_TP" ? "사업종료일" : "과제종료일"
  return (
    <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
      {라벨}
      <br />
      {row.종료일}
    </span>
  )
}
