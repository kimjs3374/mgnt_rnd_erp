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
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset className="flex flex-1 flex-col">{children}</SidebarInset>
        </div>
      </SidebarProvider>
      <ChatPanel />
    </div>
  )
}
