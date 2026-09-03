"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { PROJECT_TABS } from "@/lib/nav"

/**
 * 과제 상세 탭. 사이드바가 아니라 **과제 안에서** 화면을 가른다.
 *
 * 왜 클라이언트 컴포넌트인가 — 어느 탭이 켜져 있는지는 경로에서만 알 수 있는데
 * 서버 레이아웃에는 pathname 이 안 들어온다. 딱 그것만 하는 얇은 조각이라
 * 데이터는 전부 서버 컴포넌트인 각 탭이 직접 읽는다.
 *
 * ⚠ **종료된 과제에는 「연구비 계상」 탭을 두지 않는다**(2026-09-03 사용자 지시).
 *   계상은 협약·수행 중에 하는 일이다. 끝난 과제에 계상 탭이 열려 있으면
 *   아직 배정을 고칠 수 있다는 뜻으로 읽히고, 실제로 고치면 정산 대조 기준이 바뀐다.
 *   **탭을 빼도 지난 계상은 사라지지 않는다** — 정산 탭의 과제비 원장이 그 배정액을 쓴다.
 *   숨기는 것은 「할 일」이지 「본 것」이 아니다.
 */
const 계상_SEG = "budget"

/** 상태 어휘는 DB 값을 그대로 쓴다 — `수행중 / 신청중 / 종료`. "수행" 으로 비교하면 언제나 0 이다. */
function 계상하는_단계인가(상태: string | null | undefined): boolean {
  return 상태 !== "종료"
}

export function ProjectTabs({ id, 상태 }: { id: number; 상태?: string | null }) {
  const pathname = usePathname()
  const base = `/projects/${id}`
  // 탭 목록은 lib/nav.ts 가 갖는다 — 브레드크럼과 같은 표를 봐야 이름이 어긋나지 않는다.
  // 거기서 지우지 않고 여기서 거르는 이유: 같은 표를 브레드크럼도 보기 때문에
  // 목록에서 빼면 /projects/13/budget 의 브레드크럼이 「연구비 계상」을 못 찾는다.
  const tabs = PROJECT_TABS.filter(
    (t) => t.seg !== 계상_SEG || 계상하는_단계인가(상태),
  ).map((t) => ({
    title: t.title,
    href: t.seg ? `${base}/${t.seg}` : base,
  }))

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => {
        const on = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
              on
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.title}
          </Link>
        )
      })}
    </div>
  )
}
