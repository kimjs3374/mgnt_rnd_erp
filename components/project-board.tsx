"use client"

import * as React from "react"
import Link from "next/link"
import { Briefcase } from "lucide-react"
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
 *   ⚠ **미선정 건은 뺀다.** 세 단계 어디에도 안 넣는다.
 *   ⚠ **탭 순서·경로는 `단계정의` 하나에서 가져온다.**
 *
 * 2026-09-04 개편(4차) — 페이지당 8줄 → 3줄. 옆(아래) 「오늘 처리할 것」이 남는 자리를 메운다.
 *
 * 2026-09-04 개편(11차) — 배지를 키우고, 날짜를 오른쪽 별도 칸에서 부제 줄로 옮겼다.
 *   ⚠ **오른쪽 끝에 날짜를 따로 두던 걸 없앴다.** 과제명 칸이 `flex-1`(남는 공간을
 *     다 차지)이라 이름이 짧은 날엔 이름과 날짜 사이에 빈 칸이 넓게 남았다(실사용
 *     지적). 날짜를 부제 줄("기관 · 1차년도 · 과제종료일 2026-10-01")에 합치면
 *     그 칸 자체가 없어져서 간격 문제가 원천적으로 사라진다.
 *   ⚠ **배지를 크게, 사각형으로 키웠다**(사용자가 준 참고 그림). 다만 그림의
 *     꽉 찬 파란 배경은 안 썼다 — 이 대시보드의 다른 배지(공고 확인의 자격판정,
 *     오늘 처리할 것의 갈래)가 전부 테두리+옅은 배경(outline) 스타일이라, 하나만
 *     꽉 찬 색으로 하면 이 카드만 튀어 보인다. 색은 살리되(과제=파랑·지원사업=보라)
 *     톤은 다른 배지와 맞춘다.
 *   ⚠ 줄 높이를 52px → 56px 로 살짝 키웠다 — 배지가 커진 만큼 자리를 준다.
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
type ProjectRowExt = ProjectRow & { 선정결과?: string | null; 공고_id?: number | null }

/**
 * `사업유형` 대신 쓸 것 없을 때만 부른다. 공고 확인 카드의 `탭구분`과 같은 기준(출처) —
 * 실측으로 기업마당(304건 중 2건)·K-Startup(1000건 중 0건)은 사업유형을 거의 안 채운다.
 * IRIS·NTIS 는 항상 채우므로(NATIONAL_RND) 여기까지 올 일이 없다.
 */
function 출처로_유형추정(출처?: string): string | null {
  if (출처 === "기업마당" || 출처 === "K-Startup") return "LOCAL_TP"
  if (출처 === "IRIS" || 출처 === "NTIS") return "NATIONAL_RND"
  return null
}

export function ProjectBoard({
  rows,
  공고출처,
  today,
  error,
}: {
  rows: ProjectRow[]
  /** 공고 id → 출처. `사업유형`이 빈 건의 배지를 대신 판정하는 데만 쓴다. */
  공고출처: Record<number, string | undefined>
  /** 「오늘」은 서버가 정한다. 심사장 PC 시계를 믿지 않는다. */
  today: string
  error?: string | null
}) {
  const 대상 = React.useMemo(() => {
    const ext = rows as ProjectRowExt[]
    return ext
      .filter((r) => !미선정인가(r))
      .map((r) => ({
        row: r,
        단계: 단계판정(r, today),
        유형: r.사업유형 ?? 출처로_유형추정(r.공고_id != null ? 공고출처[r.공고_id] : undefined),
      }))
      .filter((x) => x.단계 !== "사업종료")
  }, [rows, today, 공고출처])

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
    () => 대상.filter((x) => x.단계 === 현재),
    [대상, 현재],
  )
  const 총페이지 = Math.max(1, Math.ceil(전체행.length / 페이지당))
  const 현재페이지 = Math.min(page, 총페이지 - 1)
  const 보이는행 = 전체행.slice(현재페이지 * 페이지당, 현재페이지 * 페이지당 + 페이지당)

  const 단계경로_ = (t: 과제단계) => 단계정의.find((d) => d.단계 === t)?.경로 ?? "/projects"

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--success)] text-[var(--success-fg)]">
            <Briefcase className="size-3.5" />
          </span>
          <h2 className="text-sm font-semibold">통합 관리</h2>
        </div>
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
            {보이는행.map(({ row: r, 유형 }) => (
              <li key={r.id} className="h-[52px]">
                <Link
                  href={`/projects/${r.id}`}
                  className="flex h-full items-center gap-1.5 px-2 hover:bg-muted"
                >
                  {/* 배지를 사업명·부제 두 줄 블록과 나란한 열로 뺐다 — items-center 라
                      두 줄의 세로 가운데에 온다. 두 줄은 같은 블록 안이라 시작점이 같다. */}
                  <사업유형배지 코드={유형} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]" title={r.과제명}>
                      {r.과제명}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {부제(r, 현재, 유형)}
                    </span>
                  </span>
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

/**
 * 과제/지원사업 — 지금은 다 같은 값(NATIONAL_RND)이지만 지자체 사업이 들어오면 갈린다.
 * 2026-09-04: 한 번 크게(사각형) 키웠다가 되돌렸다 — 원래의 작은 테두리 배지가
 * 다른 카드들(공고 확인·오늘 처리할 것)의 배지 크기·톤과 더 잘 맞았다(사용자 확인).
 */
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
 * 부제 줄 — 기관·연차·날짜를 한 줄로 합친다.
 * 신청중·신청완료는 아직 협약 전이라 종료일이 의미 없다 — 시작 예정일을 쓴다.
 * 수행중은 종료일(연도 포함, 전체)을 쓴다. D-day 는 없다 — 마감 임박은 일정(달력) 카드가 담당한다.
 */
function 부제(row: ProjectRow, 단계: 과제단계 | null, 유형: string | null): string {
  const 기관 = row.부처 ?? row.전문기관 ?? "기관 미상"
  const 조각 = [기관]
  if (row.연차 != null) 조각.push(`${row.연차}차년도`)

  if (단계 === "신청중" || 단계 === "신청완료") {
    if (row.시작일) 조각.push(`시작 예정 ${row.시작일}`)
  } else if (row.종료일) {
    const 라벨 = 유형 === "LOCAL_TP" ? "사업종료일" : "과제종료일"
    조각.push(`${라벨} ${row.종료일}`)
  }

  return 조각.join(" · ")
}
