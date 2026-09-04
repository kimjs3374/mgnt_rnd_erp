import { cn } from "@/lib/utils"

const 유형라벨: Record<string, string> = {
  상시: "상시",
  소진시: "예산 소진시",
  상이: "회차별 상이",
  완료시: "모집 완료시",
  미상: "미상",
  // NTIS 과제검색처럼 접수 개념이 없는 메타정보(lib/queries.ts 의 정보성) — 신청 대상이 아니다.
  정보성: "참고자료",
}

function toneClass(tone: "danger" | "warn" | "info" | "neutral") {
  switch (tone) {
    case "danger":
      return "bg-destructive/10 text-destructive"
    case "warn":
      return "bg-[var(--warning)] text-[var(--warning-fg)]"
    case "info":
      return "bg-secondary text-secondary-foreground"
    default:
      return "border border-border text-muted-foreground"
  }
}

/**
 * 오늘 기준 D-day. 서버 로컬 시간이 Asia/Seoul 로 맞춰져 있다는 전제(실측: `date` 가 +09:00 를 준다).
 * 접수종료가 없으면 null — 지어내지 않는다.
 */
export function dDay(접수종료: string | null): number | null {
  if (!접수종료) return null
  const [y, m, d] = 접수종료.split("-").map(Number)
  if (!y || !m || !d) return null
  const end = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end - today) / 86400000)
}

/**
 * 접수기간 배지. 접수기간의 절반 이상이 날짜가 아니다(상시·소진시·상이 등, scripts/collect-bizinfo.mjs
 * parseDeadline 참고) — 날짜형만 D-day 로 계산하고 나머지는 유형 배지로 그대로 보여준다.
 * 날짜를 지어내지 않는다.
 */
export function DeadlineBadge({
  마감유형,
  접수종료,
}: {
  마감유형: string
  접수종료: string | null
}) {
  if (마감유형 !== "dated") {
    const label = 유형라벨[마감유형] ?? 마감유형
    const tone = 마감유형 === "미상" ? "warn" : 마감유형 === "정보성" ? "neutral" : "info"
    return (
      <span
        className={cn(
          "inline-flex h-5 w-fit shrink-0 items-center rounded-4xl px-2 text-xs font-medium",
          toneClass(tone),
        )}
      >
        {label}
      </span>
    )
  }

  const d = dDay(접수종료)
  if (d == null) {
    return (
      <span
        className={cn(
          "inline-flex h-5 w-fit shrink-0 items-center rounded-4xl px-2 text-xs font-medium",
          toneClass("warn"),
        )}
      >
        미상
      </span>
    )
  }

  const tone = d < 0 ? "neutral" : d <= 3 ? "danger" : d <= 14 ? "warn" : "neutral"
  const label = d < 0 ? "마감" : d === 0 ? "오늘마감" : `D-${d}`

  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          "inline-flex h-5 w-fit shrink-0 items-center rounded-4xl px-2 text-xs font-medium tabular-nums",
          toneClass(tone),
        )}
      >
        {label}
      </span>
      <span className="text-[12.1px] text-muted-foreground tabular-nums">~{접수종료}</span>
    </div>
  )
}
