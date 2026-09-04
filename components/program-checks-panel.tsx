"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dismissCheck } from "@/app/actions/program-checks"
import type { CheckRow } from "@/lib/queries-checks"

const ACTOR = "magnatech"

const 심각도톤: Record<string, string> = {
  오류: "border-l-destructive bg-destructive/5",
  경고: "border-l-[var(--warning-fg)] bg-[var(--warning)]/30",
  정보: "border-l-border bg-muted/30",
}

/**
 * 제출 전 점검 목록 — 계산으로 걸린 것만 보여준다(기한임박·금액불일치, LLM 없음).
 * 「무시」를 누르면 사유를 반드시 받는다 — decisions·eligibility_decisions 와 같은 원칙이다.
 * 조건 자체를 고쳤으면(예: 완료보고 입력) 다시 스크립트를 돌렸을 때 저절로 안 걸린다 —
 * 그래서 버튼은 "무시"만 있다. "고쳤다"는 사람이 누르는 게 아니라 조건이 스스로 증명한다.
 */
export function ProgramChecksPanel({ rows }: { rows: CheckRow[] }) {
  const [대상, set대상] = React.useState<CheckRow | null>(null)
  const [사유, set사유] = React.useState("")
  const [오류, set오류] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()
  const [숨김, set숨김] = React.useState<Set<number>>(new Set())

  const 보이는것 = rows.filter((r) => !숨김.has(r.id))

  if (보이는것.length === 0) return null

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <ShieldAlert className="size-3.5" />
        </span>
        <h2 className="text-sm font-semibold">제출 전 점검</h2>
        <span className="text-xs text-muted-foreground">
          {보이는것.length}건 · 계산으로 걸린 것만(기한임박·금액불일치)
        </span>
      </div>

      <ul className="divide-y">
        {보이는것.map((r) => (
          <li
            key={r.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-l-4 p-3 text-[14.3px] ${심각도톤[r.심각도] ?? ""}`}
          >
            <AlertTriangle className="size-4 shrink-0 text-current" />
            <Link
              href={`/projects/${r.과제_id}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {r.과제명}
            </Link>
            <span className="text-muted-foreground">{r.내용}</span>
            <Button
              type="button"
              variant="outline"
              className="ml-auto h-6 px-2 text-[12.7px]"
              onClick={() => {
                set대상(r)
                set사유("")
                set오류(null)
              }}
            >
              무시
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={대상 != null} onOpenChange={(o) => !o && set대상(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이 점검을 무시할까요?</DialogTitle>
            <DialogDescription>
              {대상?.내용} — 조건 자체는 그대로 남습니다. 왜 지금은 괜찮은지 이유를 남겨야
              합니다.
            </DialogDescription>
          </DialogHeader>
          <input
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="무시하는 이유 (필수)"
            value={사유}
            onChange={(e) => set사유(e.target.value)}
          />
          {오류 && <p className="text-sm text-destructive">{오류}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => set대상(null)}>
              취소
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!대상) return
                const id = 대상.id
                start(async () => {
                  const r = await dismissCheck(id, 사유, ACTOR)
                  if (r.ok) {
                    set숨김((s) => new Set(s).add(id))
                    set대상(null)
                  } else {
                    set오류(r.error ?? "처리하지 못했습니다.")
                  }
                })
              }}
            >
              {pending ? "처리 중…" : "무시하고 사유 남기기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
