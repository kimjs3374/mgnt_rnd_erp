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

          <div className="space-y-3">
            {과제들.map((p) => (
              <div key={p.id} className="rounded-lg border">
                <div className="flex flex-wrap items-baseline gap-2 border-b p-2.5">
                  <Link
                    href={`/projects/${p.id}/expenses`}
                    className="text-[13px] font-medium underline-offset-2 hover:underline"
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
