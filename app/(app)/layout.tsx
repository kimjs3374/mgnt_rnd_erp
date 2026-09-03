import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { ChatPanel } from "@/components/chat-panel"

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
          <AppSidebar />
          <SidebarInset className="flex min-w-0 flex-1 flex-col">{children}</SidebarInset>
        </div>
      </SidebarProvider>
      <ChatPanel />
    </div>
  )
}
