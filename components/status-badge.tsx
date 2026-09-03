import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * 상태 배지 4종.
 * shadcn 에 셋(outline / default / destructive)은 이미 규격대로 있고,
 * 「신뢰도 낮음」의 soft warning 하나만 우리가 만든다. (UI레퍼런스.md §4.3)
 *
 * 진행 중인 것만 눈에 띄게 하고 완료된 것은 조용히 둔다 —
 * 확정·정산완료가 가장 흔한 상태인데 테두리만 쓰는 이유가 그것이다.
 */
type Tone = "done" | "pending" | "danger" | "warn"

const TONE: Record<string, Tone> = {
  확정: "done",
  정산완료: "done",
  종료: "done",
  선정: "done",
  유효: "done",
  확인됨: "done",

  검토대기: "pending",
  제출: "pending",
  수행: "pending",
  심사: "pending",
  대기: "pending",
  미확인: "pending",

  반려: "danger",
  탈락: "danger",
  만료: "danger",
  "한도 초과": "danger",

  검토: "warn",
  미신청: "warn",
  만료임박: "warn",
  확인필요: "warn",
  없음: "warn",
}

export function StatusBadge({ value }: { value: string }) {
  const tone = TONE[value] ?? "pending"

  if (tone === "warn") {
    // soft warning — 레퍼런스에 없어서 직접 만든 하나.
    return (
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium",
          "bg-[var(--warning)] text-[var(--warning-fg)]",
        )}
      >
        {value}
      </span>
    )
  }

  return (
    <Badge
      variant={
        tone === "done" ? "outline" : tone === "danger" ? "destructive" : "default"
      }
      className="h-5 rounded-4xl px-2 text-xs font-medium"
    >
      {value}
    </Badge>
  )
}

/** AI 확신도. 0.70 미만은 코드가 자동 확정을 막는 지점이라 화면에서도 구분한다. */
export function ConfidenceBadge({ value }: { value: number | null }) {
  if (value == null)
    return <span className="text-xs text-muted-foreground">—</span>

  const pct = Math.round(value * 100)
  const low = value < 0.7
  const mid = value < 0.9

  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium tabular-nums",
        low
          ? "bg-[var(--warning)] text-[var(--warning-fg)]"
          : mid
            ? "bg-secondary text-foreground"
            : "border border-border text-foreground",
      )}
      title={low ? "0.70 미만 — 자동 확정이 차단된다" : undefined}
    >
      {pct}%
    </span>
  )
}
