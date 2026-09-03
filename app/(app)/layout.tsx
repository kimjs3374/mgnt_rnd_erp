import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { ChatPanel } from "@/components/chat-panel"
import { getCurrentUser } from "@/lib/current-user"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  return (
    <div
      className="[--header-height:56px] [--sidebar-width:239px]"
      style={
        {
          "--header-height": "56px",
          "--sidebar-width": "239px",
        } as React.CSSProperties
      }
    >
      <SidebarProvider className="flex flex-col">
        <SiteHeader />
        {/* ⚠ min-w-0 이 없으면 flex 자식의 min-width 기본값이 auto 라
            안쪽 표가 넓어질 때 본문이 같이 넓어지고 **페이지 전체에 가로 스크롤이 생긴다.**
            사이드바는 고정폭이므로 줄어들 쪽은 본문이어야 한다. */}
        <div className="flex min-w-0 flex-1">
          {/* AppSidebar의 prop 이름은 role이 아니라 userRole이다 — Sidebar가 이미 상속하는
              네이티브 ARIA role과 이름이 겹치면 안 되기 때문(components/app-sidebar.tsx 참조).
              그래서 여기선 user.role(null 포함)을 그대로 넘겨도 된다. */}
          <AppSidebar
            userRole={user.role}
            userDepartment={user.department}
            userLabel={user.인증 ? user.이름 : null}
          />
          <SidebarInset className="flex min-w-0 flex-1 flex-col">{children}</SidebarInset>
        </div>
      </SidebarProvider>
      <ChatPanel />
    </div>
  )
}
