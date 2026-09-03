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
 */
export function ProjectTabs({ id }: { id: number }) {
  const pathname = usePathname()
  const base = `/projects/${id}`
  // 탭 목록은 lib/nav.ts 가 갖는다 — 브레드크럼과 같은 표를 봐야 이름이 어긋나지 않는다.
  const tabs = PROJECT_TABS.map((t) => ({
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
