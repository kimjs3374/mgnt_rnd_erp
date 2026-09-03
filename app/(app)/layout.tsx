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
          {/* ⚠ role 은 null 이 될 수 있는데(로그인 전·승인 대기) AppSidebar 는 undefined 만 받는다.
              dev 서버는 타입검사를 안 해서 화면은 멀쩡했지만 npm run build 가 여기서 막혔다 —
              발표용 prod 전환에서 처음 터질 자리였다. 동작은 그대로고 타입만 맞춘다. */}
          <AppSidebar role={user.role ?? undefined} userLabel={user.인증 ? user.이름 : null} />
          <SidebarInset className="flex min-w-0 flex-1 flex-col">{children}</SidebarInset>
        </div>
      </SidebarProvider>
      <ChatPanel />
    </div>
  )
}
