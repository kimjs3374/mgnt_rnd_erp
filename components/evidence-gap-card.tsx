"use client"

import * as React from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Stat } from "@/components/page-shell"
import type { 증빙구멍 } from "@/lib/evidence-gap-types"

/**
 * 「사업비 증빙 미비」 카드 — **눌러서 목록을 보고 그 자리로 간다.** (2026-09-04 사용자 지시)
 *
 * 숫자만 있으면 「3건」을 보고도 무엇을 해야 할지 모른다. 그래서 누르면
 * **어느 과제의 어느 집행에 무슨 서류가 없는지**를 한 줄씩 보여주고,
 * 각 줄에서 그 집행 건의 증빙 칸으로 바로 보낸다(`?expense=<id>` — 집행 표가 그 건을 펼친 채로 연다).
 *
 * 오래된 집행부터 세운다 — 정산 마감이 먼저 닿는 쪽이다(조회 계층이 그 순서로 준다).
 */

const won = (n: number | null | undefined) =>
  n == null ? "—" : `₩${Math.round(Number(n)).toLocaleString("ko-KR")}`

export type 과제구멍 = { id: number; 과제명: string; 구멍: 증빙구멍 }

/**
 * 과제 블록을 갈라 보이게 하는 **구분용** 색. (2026-09-04 사용자 지시)
 *
 * ⚠ **뜻이 없는 색이다.** 이 앱에서 색은 대개 뜻을 지고 있다 —
 *   연빨강=종료 · 호박(warning)=손봐야 함 · 초록=여유 · 차트 팔레트=비목.
 *   여기 색은 「몇 번째 과제인가」만 말한다. 그래서 **경고·상태 계열을 피해서** 골랐고
 *   순서대로 돌려 쓴다. 과제가 다섯을 넘으면 처음 색으로 돌아온다 — 붙어 있는 두 블록만
 *   서로 다르면 되기 때문이다.
 *
 * 색만으로 가르지 않는다 — **왼쪽 굵은 띠 + 머리 배경 + 순번**을 같이 준다.
 * 색을 못 보는 사람에게도 갈라져 보여야 한다.
 */
const 구분색 = [
  "border-l-sky-400 dark:border-l-sky-600",
  "border-l-violet-400 dark:border-l-violet-600",
  "border-l-teal-400 dark:border-l-teal-600",
  "border-l-slate-400 dark:border-l-slate-500",
  "border-l-fuchsia-400 dark:border-l-fuchsia-600",
]

export function EvidenceGapCard({
  과제들,
  비목이름 = {},
}: {
  과제들: 과제구멍[]
  /** 비목 코드 → 한글. 화면에 EQUIP_PURCHASE 가 보이면 안 된다. */
  비목이름?: Record<string, string>
}) {
  const [열림, set열림] = React.useState(false)
  const 빈집행건 = 과제들.reduce((s, p) => s + p.구멍.빈집행건, 0)
  const 빈칸 = 과제들.reduce((s, p) => s + p.구멍.빈칸, 0)
  const 있다 = 과제들.length > 0

  const 카드 = (
    <Stat
      icon={TriangleAlert}
      label="사업비 증빙 미비"
      value={과제들.length}
      sub={
        있다
          ? `과제 ${과제들.length}건 · 집행 ${빈집행건}건에 서류 ${빈칸}칸이 비었다 — 눌러서 보기`
          : "집행 건별 필수 서류가 다 채워져 있다"
      }
      tone={있다 ? "warn" : "default"}
    />
  )

  // 구멍이 없으면 누를 것도 없다. 눌러도 빈 목록이 뜨는 버튼을 만들지 않는다.
  if (!있다) return 카드

  return (
    <>
      <button
        type="button"
        className="cursor-pointer text-left transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => set열림(true)}
        aria-label={`사업비 증빙 미비 ${과제들.length}건 — 목록 보기`}
      >
        {카드}
      </button>

      <Dialog open={열림} onOpenChange={set열림}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              사업비 증빙 미비 — 과제 {과제들.length}건 · 집행 {빈집행건}건 · 빈 칸 {빈칸}
            </DialogTitle>
            <DialogDescription>
              집행 건에 붙어야 하는 <b>필수 서류</b>가 빈 곳입니다. 정산에서 반려되는 자리라
              오래된 집행부터 세웠습니다. 줄을 누르면 그 집행 건의 증빙 칸으로 바로 갑니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {과제들.map((p, i) => (
              <div
                key={p.id}
                className={`overflow-hidden rounded-lg border border-l-4 ${구분색[i % 구분색.length]}`}
              >
                <div className="flex flex-wrap items-baseline gap-2 border-b bg-secondary/60 p-2.5">
                  {/* 순번 — 색을 못 봐도 「몇 번째 과제」인지는 읽힌다. */}
                  <span className="rounded bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {i + 1}/{과제들.length}
                  </span>
                  <Link
                    href={`/projects/${p.id}/expenses`}
                    className="text-[13px] font-semibold underline-offset-2 hover:underline"
                  >
                    {p.과제명}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    집행 {p.구멍.빈집행건}건 / {p.구멍.집행건}건 · 빈 칸 {p.구멍.빈칸}
                  </span>
                </div>
                <ul className="divide-y">
                  {p.구멍.상세.map((e) => (
                    <li key={e.집행_id} className="flex flex-wrap items-baseline gap-x-2 p-2.5">
                      <span className="text-[12.5px] tabular-nums text-muted-foreground">
                        {e.일자 ?? "일자 미상"}
                      </span>
                      <span className="text-[13px] font-medium">{e.거래처 ?? "거래처 미상"}</span>
                      <span className="text-[12.5px] tabular-nums text-muted-foreground">
                        {won(e.합계)}
                      </span>
                      {e.비목_대분류 && (
                        <span className="text-[12px] text-muted-foreground">
                          {비목이름[e.비목_대분류] ?? e.비목_대분류}
                        </span>
                      )}
                      {/* 무슨 서류가 없는지까지 적는다 — 「증빙 부족」만으로는 무엇을 준비할지 모른다. */}
                      <span className="w-full text-[12.5px] text-[var(--warning-fg)]">
                        없는 서류: {e.빠진서류.join(" · ")}
                      </span>
                      <Link
                        href={`/projects/${p.id}/expenses?expense=${e.집행_id}`}
                        className="ml-auto rounded-md border px-2 py-0.5 text-[12px] hover:bg-secondary"
                        onClick={() => set열림(false)}
                      >
                        채우러 가기 →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            비목별로 요구 서류가 다릅니다(`app.evidence_requirements`). 인건비·간접비처럼 집행 건별
            증빙을 요구하지 않는 비목은 여기 세지 않습니다 — 없는 요건을 「비었다」고 하면 그게 거짓말입니다.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
