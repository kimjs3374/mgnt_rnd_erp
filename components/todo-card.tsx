"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/components/status-badge"

/**
 * 오늘 처리할 것 — 「비목 확정」·「챙길 서류」·「제출 전 점검」 세 갈래를 한 카드에 담는다.
 *
 * 2026-09-04 개편(6차) — 갈래 소제목·`divide-y` 큰 구획을 걷어내고 **한 줄짜리 통합
 * 목록 + 배지**로 바꿨다.
 *   ⚠ **0건 갈래는 아예 안 보여준다.** 「걸린 게 생길 때마다 뜨게」가 이 카드의 기준이다.
 *   ⚠ **셋 다 0건이면 카드는 남기고 안에 「지금 손댈 것이 없습니다」를 띄운다.**
 *     이 카드는 오른쪽 열에서 `flex-1` 로 남는 세로 공간을 흡수하는 역할도 겸한다.
 *   ⚠ **갈래마다 색을 다르게 준 작은 배지**로 구분한다(대기=인디고·서류=청록·
 *     점검=슬레이트 — 이 앱에서 아직 안 쓴 색들이다). 「챙길 서류」 줄은 오른쪽에
 *     이미 `StatusBadge`(주황·빨강 계열)가 붙어 있어서, 왼쪽 배지가 같은 색 계열이면
 *     한 줄에 색이 두 겹 생겨 오히려 산만해진다 — 그래서 겹치지 않는 색만 썼다.
 *
 * 2026-09-04 개편(7차) — 「외 N건」이 `<p>`라서 눌러도 아무 일이 안 났다(실사용 지적).
 *   B안 채택: **세 갈래를 한 카드에서 동시에 보는 건 그대로 두고**(「한눈에」 원칙 유지),
 *   갈래마다 **자체 페이지 넘김**(‹ n/m ›)을 둔다. 「전체 보기」를 카드 헤더에 하나만
 *   두는 A안은 버렸다 — 갈래마다 목적지가 다른데(`/expenses`·`/documents`·`/programs`)
 *   카드 레벨 링크 하나로는 어디로 갈지 정할 수 없었다.
 *   ⚠ 그래서 **`항목` 은 이제 미리보기 몇 개가 아니라 그 갈래의 전체 목록**이어야 한다
 *     (`app/(app)/dashboard/page.tsx` 가 더는 `.slice(0, 4)` 로 자르지 않는다) —
 *     안 그러면 페이지를 넘겨도 두 번째 페이지에 보여줄 게 없다.
 *   ⚠ 페이지 상태는 **갈래별로 따로** 둔다(`Record<라벨, 페이지번호>`). 한 상태를
 *     공유하면 「서류」를 2페이지로 넘겼는데 「점검」도 같이 2페이지로 넘어가 버린다.
 *
 * 2026-09-04 개편(8차) — 마지막 페이지가 항목 수보다 적으면(1페이지 4줄, 2페이지
 *   2줄) 카드 안 내용량이 페이지마다 달라졌고, 이 카드가 오른쪽 열에서 `flex-1`
 *   로 남는 공간을 채우는 역할이라 **카드 테두리 자체가 228.5px → 170.5px로
 *   움직였다**(실측). 과제 관리·공고 확인이 이미 쓰는 방법과 같게, **페이지가
 *   여러 장인 그룹만** 마지막 페이지를 빈 줄로 채워 항상 페이지당 줄 수를
 *   유지한다. 페이지가 한 장뿐인 그룹(예: 대기 1건)은 안 건드린다 — 며칠에 한 번
 *   있는 항목 하나를 억지로 4줄로 부풀리면 없는 걸 있어 보이게 만드는 셈이다.
 */
export type 큐항목 = {
  키: string
  이름: string
  꼬리: string
  /** 꼬리를 상태 배지로 그릴지. 「만료」·「없음」처럼 값이 상태일 때만 참. */
  배지?: boolean
}

export type 큐갈래 = {
  라벨: string
  링크: string
  건수: number
  /** 이 갈래의 전체 목록. 미리보기로 자르지 않는다 — 페이지 넘김이 나머지를 보여준다. */
  항목: 큐항목[]
}

/** 갈래 이름 → 짧은 배지 글자·색. 여기 없는 갈래가 오면 회색 테두리로 무난하게 그린다. */
const 갈래스타일: Record<string, { 짧은: string; 색: string }> = {
  "비목 확정": {
    짧은: "대기",
    색: "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
  "챙길 서류": {
    짧은: "서류",
    색: "border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  "제출 전 점검": {
    짧은: "점검",
    색: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-400",
  },
}

const 페이지당 = 4

export function TodoCard({ 갈래들 }: { 갈래들: 큐갈래[] }) {
  const 걸린것 = 갈래들.filter((g) => g.건수 > 0)
  const 총건수 = 갈래들.reduce((n, g) => n + g.건수, 0)

  // 갈래별로 따로 둔다 — 한 갈래를 넘겨도 다른 갈래 페이지가 같이 안 밀린다.
  const [페이지, set페이지] = React.useState<Record<string, number>>({})

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">오늘 처리할 것</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{총건수}건</span>
      </div>

      {걸린것.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          지금 손댈 것이 없습니다
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          {걸린것.map((g, gi) => {
            const 스타일 = 갈래스타일[g.라벨] ?? {
              짧은: g.라벨.slice(0, 2),
              색: "border-border text-muted-foreground",
            }
            const 총페이지 = Math.max(1, Math.ceil(g.항목.length / 페이지당))
            const 현재페이지 = Math.min(페이지[g.라벨] ?? 0, 총페이지 - 1)
            const 보이는 = g.항목.slice(현재페이지 * 페이지당, 현재페이지 * 페이지당 + 페이지당)
            const 넘기기 = (delta: number) =>
              set페이지((p) => ({ ...p, [g.라벨]: 현재페이지 + delta }))

            return (
              <div key={g.라벨} data-group={g.라벨} className={cn(gi > 0 && "mt-1.5")}>
                {보이는.map((it) => (
                  <Link
                    key={it.키}
                    href={g.링크}
                    className="flex h-7 items-center gap-2 rounded px-1 hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "inline-flex h-4 shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-none",
                        스타일.색,
                      )}
                    >
                      {스타일.짧은}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{it.이름}</span>
                    <span className="shrink-0">
                      {it.배지 ? (
                        <StatusBadge value={it.꼬리} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{it.꼬리}</span>
                      )}
                    </span>
                  </Link>
                ))}
                {/* 페이지가 여러 장인 그룹만 빈 줄로 채운다 — 마지막 페이지가 짧다고
                    카드 내용량이 줄면 flex-1 계산이 흔들려 카드 테두리가 움직인다. */}
                {총페이지 > 1 &&
                  Array.from({ length: 페이지당 - 보이는.length }).map((_, i) => (
                    <div key={`filler-${i}`} aria-hidden className="h-7" />
                  ))}

                {/* 갈래 하나에 항목이 페이지당 수보다 많을 때만 뜬다. 「외 N건」 대신 이게 전체를 보여준다. */}
                {총페이지 > 1 && (
                  <div className="flex items-center justify-end gap-1.5 px-1 pt-0.5 text-[11px] text-muted-foreground">
                    <button
                      type="button"
                      disabled={현재페이지 === 0}
                      onClick={() => 넘기기(-1)}
                      aria-label={`${g.라벨} 이전 페이지`}
                      className="flex size-4 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      ‹
                    </button>
                    <span className="tabular-nums">
                      {현재페이지 + 1} / {총페이지}
                    </span>
                    <button
                      type="button"
                      disabled={현재페이지 >= 총페이지 - 1}
                      onClick={() => 넘기기(1)}
                      aria-label={`${g.라벨} 다음 페이지`}
                      className="flex size-4 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
