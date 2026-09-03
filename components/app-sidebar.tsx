"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { NAV } from "@/lib/nav"
import { logout } from "@/app/actions/auth"
import {
  Briefcase,
  Building2,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  PieChart,
  ReceiptText,
  Layers,
  ShieldCheck,
} from "lucide-react"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  FolderKanban,
  Briefcase,
  ReceiptText,
  PieChart,
  ClipboardCheck,
  Building2,
  ShieldCheck,
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /**
   * 최고관리자(admin)에게만 「관리자」 메뉴를 보여준다.
   * ⚠ 이름을 `role`이 아니라 `userRole`로 둔다 — `Sidebar`는 `ComponentProps<"div">`를
   *   상속해서 네이티브 ARIA `role` 속성을 이미 갖고 있다. 같은 이름으로 커스텀 prop을
   *   더하면 교집합 타입이 되어 `"admin"`을 못 받는데, dev 서버(Turbopack)는 타입검사를
   *   건너뛰어 화면은 멀쩡하다가 `npm run build`(tsc)에서만 터진다. 이름을 바꿔 충돌 자체를 없앤다.
   */
  userRole?: "member" | "admin" | null
  userLabel?: string | null
}

export function AppSidebar({ userRole, userLabel, ...props }: AppSidebarProps) {
  const pathname = usePathname()
  // 「관리자」 그룹은 userRole=admin 일 때만 사이드바에 노출한다.
  // NAV 자체에는 항상 들어 있다 — 안 그러면 /admin/users 브레드크럼이 못 찾는다(lib/nav.ts 참조).
  const visibleNav = userRole === "admin" ? NAV : NAV.filter((g) => g.title !== "관리자")

  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Layers className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">잔업제로</span>
                <span className="truncate text-xs text-muted-foreground">
                  지원사업 관리
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>메뉴</SidebarGroupLabel>
          <SidebarMenu>
            {visibleNav.map((group) => {
              const Icon = ICONS[group.icon] ?? Layers
              const active =
                pathname === group.url ||
                group.items?.some((i) => i.url === pathname)

              return (
                <SidebarMenuItem key={group.title}>
                  <SidebarMenuButton
                    isActive={!!active}
                    render={<Link href={group.url} />}
                  >
                    <Icon className="size-4" />
                    <span>{group.title}</span>
                  </SidebarMenuButton>

                  {group.items && (
                    <SidebarMenuSub>
                      {group.items.map((leaf) => (
                        <SidebarMenuSubItem key={leaf.url}>
                          <SidebarMenuSubButton
                            isActive={pathname === leaf.url}
                            render={<Link href={leaf.url} />}
                          >
                            <span>{leaf.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          <div className="font-medium text-sidebar-foreground">
            {userLabel ?? "매그나텍"}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>본선 데모 · 합성데이터</span>
            <form action={logout}>
              <button type="submit" className="underline hover:text-sidebar-foreground">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
