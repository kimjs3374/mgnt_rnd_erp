import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * 상태 배지 5종.
 * shadcn 에 셋(outline / default / destructive)은 이미 규격대로 있고,
 * soft warning(「신뢰도 낮음」)과 soft success(자격판정 「가능」)를 우리가 만든다.
 * (UI레퍼런스.md §4.3 — success 는 자격판정 4종을 붙이며 warning 과 대칭으로 추가)
 *
 * 진행 중인 것만 눈에 띄게 하고 완료된 것은 조용히 둔다 —
 * 확정·정산완료가 가장 흔한 상태인데 테두리만 쓰는 이유가 그것이다.
 */
type Tone = "done" | "pending" | "danger" | "warn" | "success"

const TONE: Record<string, Tone> = {
  확정: "done",
  정산완료: "done",
  종료: "done",
  // 사업 단계 넷(`lib/project-stage.ts`). 대장의 「상태」 열이 이 이름을 찍는다 —
  // 저장된 상태가 아니라 **계산된 단계**다(2026-09-04, 둘이 서로 다른 말을 해서 맞췄다).
  // 줄 색과 결을 맞춘다: 신청중 = 대기(호박), 수행중 = 진행(파랑), 사업종료 = 끝(테두리만).
  사업종료: "done",
  신청중: "warn",
  신청완료: "warn",
  // ⚠ 「수행중」이 빠져 있어서 fallback(pending·테두리만)으로 그려지고 있었다 —
  //    줄 색은 하늘색인데 배지만 무채색이라 두 화면이 서로 다른 말을 했다(2026-09-04).
  //    색 정의는 lib/stage-style.ts 한 곳에 있고, 배지 톤도 그 결에 맞춘다.
  수행중: "pending",
  선정: "done",
  유효: "done",
  확인됨: "done",

  검토대기: "pending",
  제출: "pending",
  수행: "pending",
  심사: "pending",
  대기: "pending",
  미확인: "pending",
  요건미확인: "pending",

  반려: "danger",
  탈락: "danger",
  미선정: "danger",
  만료: "danger",
  "한도 초과": "danger",
  불가: "danger",
  미충족: "danger",

  검토: "warn",
  미신청: "warn",
  만료임박: "warn",
  확인필요: "warn",
  없음: "warn",

  가능: "success",
  충족: "success",
}

export function StatusBadge({ value }: { value: string }) {
  const tone = TONE[value] ?? "pending"

  if (tone === "warn" || tone === "success") {
    // soft warning/success — 레퍼런스에 없어서 직접 만든 것들.
    return (
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium",
          tone === "success"
            ? "bg-[var(--success)] text-[var(--success-fg)]"
            : "bg-[var(--warning)] text-[var(--warning-fg)]",
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
