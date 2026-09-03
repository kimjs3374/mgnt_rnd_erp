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
import {
  Building2,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  PieChart,
  ReceiptText,
  Layers,
} from "lucide-react"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  FolderKanban,
  ReceiptText,
  PieChart,
  ClipboardCheck,
  Building2,
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

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
            {NAV.map((group) => {
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
          <div className="font-medium text-sidebar-foreground">매그나텍</div>
          <div>본선 데모 · 합성데이터</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
