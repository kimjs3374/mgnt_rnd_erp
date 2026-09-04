import * as React from "react"
import { SlidersHorizontal } from "lucide-react"
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
    // min-w-0 — 안쪽 표가 넓어도 화면 폭을 넘기지 않게 한다(app/(app)/layout.tsx 주석 참고)
    // pb-20 — 우측 하단에 항상 떠 있는 「물어보기」버튼(ChatPanel, fixed bottom-5)이 마지막
    // 카드의 버튼·링크와 겹쳐서 안 보이는 문제가 있었다(사용자 실측, 2026-09-04:
    // 공고 상세 「지원사업 대장·연구비 계상 시작」 링크가 버튼에 가려짐) — 본문 끝에
    // 여유를 둬서 어떤 화면이든 마지막 줄이 그 자리에 오지 않게 한다.
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pb-20">
      {/* ② 제목 + 액션 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* ③ 필터 카드 */}
      {filters && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
          <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground/60" />
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
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  tone?: "default" | "warn" | "danger"
  /** 있으면 라벨 위에 작은 색 아이콘 배지를 붙인다 — 카드 여러 개가 늘어설 때 한눈에 구분되게. */
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    // ⚠ h-full — 이 카드가 <button> 안에 들어갈 때(EvidenceGapCard) 그리드 stretch 가
    //   버튼 자체에는 먹어도 안쪽 div 까지 안 내려온다. 옆 칸들과 높이가 안 맞던 원인이었다
    //   (2026-09-04 사용자 지적 — "사업비 증빙 미비 네모칸만 크기가 달라").
    <div className="h-full rounded-lg border bg-card p-4">
      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        {Icon && (
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-md",
              tone === "warn" && "bg-[var(--warning)] text-[var(--warning-fg)]",
              tone === "danger" && "bg-destructive/10 text-destructive",
              tone === "default" && "bg-primary/10 text-primary",
            )}
          >
            <Icon className="size-3" />
          </span>
        )}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-center text-2xl font-semibold tabular-nums tracking-tight",
          tone === "warn" && "text-[var(--warning-fg)]",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-center text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
