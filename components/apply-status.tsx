"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { setAnnouncementInterest, type 관심상태 } from "@/app/actions/watchlist"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const 단계: { value: 관심상태; label: string; activeClass: string }[] = [
  {
    value: "관심",
    label: "관심",
    activeClass: "border-[var(--warning-fg)] bg-[var(--warning-fg)] text-white",
  },
  {
    value: "신청예정",
    label: "신청 예정",
    activeClass: "border-[var(--success-fg)] bg-[var(--success-fg)] text-white",
  },
  // ⚠ 「신청 완료」는 여기 버튼이 아니다. 아래 등록됨 배지를 볼 것.
]

const 라벨: Record<Exclude<관심상태, null>, string> = {
  관심: "관심",
  신청예정: "신청 예정",
}

/**
 * 신청 진행 상태 — 목록의 별(WatchStar)과 같은 자리(app.watchlist, 종류='공고')를
 * 쓰지만, 여기서는 관심을 넘어 "신청예정"·"신청완료"까지 버튼으로 바로 정한다
 * (사용자 요청, 2026-09-04: "리스트에서 별을 누르면 관심 공고로 넘어가고, 상세
 * 페이지로 들어와서 신청 예정, 신청 완료 버튼을 누르면 상태가 바뀌도록").
 *
 * 버튼을 눌러도 바로 안 바뀐다 — 확인 팝업을 한 번 더 띄운다(사용자 요청, 2026-09-04:
 * "확인하러 들어왔다가 실수로 신청예정을 눌러도 모르고 나가면 그대로 남는다").
 * 이미 눌린 단계를 다시 누르면(확인 후) 표시를 지운다(null) — 잘못 정했을 때 되돌릴 방법이다.
 */
export function ApplyStatus({
  announcementId,
  initial,
  등록됨 = false,
}: {
  announcementId: number
  initial: 관심상태 | null
  /**
   * 이 공고로 **대장(app.projects)에 행이 있는가.** 그게 「신청 완료」의 유일한 뜻이다.
   *
   * 예전엔 여기에 「신청 완료」 버튼이 있었고 그건 app.watchlist 에만 남았다. 그래서
   * 공고 탐색에서 눌러도 과제 관리에 안 뜨고, 과제 관리에서 옮겨도 여기가 안 바뀌었다
   * (2026-09-04 사용자 지적). 두 테이블을 동기화하는 대신 **읽는 곳을 하나로 줄였다** —
   * 이 값은 대장에서 그대로 내려온 것이라 어느 쪽에서 바꾸든 같이 움직인다.
   */
  등록됨?: boolean
}) {
  const [상태, set상태] = React.useState(initial)
  const [pending, start] = React.useTransition()
  const [확인대상, set확인대상] = React.useState<관심상태 | null>(null)
  const [열림, set열림] = React.useState(false)

  React.useEffect(() => set상태(initial), [initial])

  const 확정 = () => {
    const next = 확인대상
    set열림(false)
    const prev = 상태
    set상태(next)
    start(async () => {
      const r = await setAnnouncementInterest(announcementId, next)
      if (!r.ok) set상태(prev)
    })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-muted-foreground">신청 상태</span>
        {단계.map((s) => {
          const active = 상태 === s.value
          return (
            <button
              key={s.value}
              type="button"
              disabled={pending}
              aria-pressed={active}
              onClick={() => {
                set확인대상(active ? null : s.value)
                set열림(true)
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
                active
                  ? s.activeClass
                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
              )}
            >
              {s.label}
            </button>
          )
        })}

        {/* 신청 완료 — 누르는 것이 아니라 **대장에서 내려온 사실**이다. */}
        <span
          title={
            등록됨
              ? "이 공고로 대장(과제 관리)에 등록된 건이 있습니다."
              : "아래 「지원 · 선정 · 대장」에서 지원을 등록하면 신청 완료가 됩니다."
          }
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            등록됨
              ? "border-primary bg-primary text-primary-foreground"
              : "border-dashed border-border bg-transparent text-muted-foreground/70",
          )}
        >
          신청 완료{등록됨 ? "" : " (미등록)"}
        </span>
      </div>

      {!등록됨 && 상태 === "신청예정" && (
        <p className="mt-2 text-xs text-muted-foreground">
          아직 대장에 등록되지 않았습니다. 아래 「지원 · 선정 · 대장」에서 등록하면
          과제 관리에도 같이 올라갑니다.
        </p>
      )}

      <Dialog open={열림} onOpenChange={set열림}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {확인대상 === null ? "신청 상태 표시를 지울까요?" : `「${라벨[확인대상]}」로 바꿀까요?`}
            </DialogTitle>
            <DialogDescription>
              {확인대상 === null
                ? "관심·신청예정·신청완료 표시가 모두 사라집니다. 실수로 누른 게 아닌지 확인하세요."
                : "목록과 대시보드에 바로 반영됩니다. 잘못 눌렀다면 여기서 취소하세요."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => set열림(false)}>
              취소
            </Button>
            <Button type="button" onClick={확정}>
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
