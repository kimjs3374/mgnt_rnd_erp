import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * 목록 화면 4단 규격 — 예외를 만들지 않는다.
 *   ① 브레드크럼(상단바)  ② 제목 + 우측 액션  ③ 필터 카드  ④ 테이블 카드
 * 이 규격을 지키면 두 번째 화면부터 15분에 끝난다. (UI레퍼런스.md §4.1)
 */
export function PageShell({
  title,
  description,
  actions,
  filters,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  filters?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* ② 제목 + 액션 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* ③ 필터 카드 */}
      {filters && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
          {filters}
        </div>
      )}

      {/* ④ 본문 */}
      {children}
    </div>
  )
}

/** 테이블 카드 — 그림자 없음, 테두리만. */
export function Card({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("rounded-lg border bg-card", className)}>{children}</div>
  )
}

/** 아직 데이터가 없을 때. 빈 상태를 안 만들면 화면이 「고장난 것처럼」 보인다. */
export function EmptyState({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** KPI 한 칸. */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  sub?: string
  tone?: "default" | "warn" | "danger"
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "warn" && "text-[var(--warning-fg)]",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
