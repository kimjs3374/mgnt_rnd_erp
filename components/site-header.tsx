"use client"

import { usePathname } from "next/navigation"
import * as React from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/components/ui/sidebar"
import { PanelLeftIcon } from "lucide-react"
import { crumbsFor } from "@/lib/nav"

export function SiteHeader() {
  const { toggleSidebar } = useSidebar()
  const pathname = usePathname()
  const crumbs = crumbsFor(pathname)

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-(--header-height) w-full items-center gap-2 px-4">
        {/* shadcn Button 은 기본이 type="button" 이다. 여긴 폼이 아니라 문제없다. */}
        <Button
          className="h-8 w-8"
          variant="ghost"
          size="icon"
          type="button"
          onClick={toggleSidebar}
          aria-label="사이드바 열기/닫기"
        >
          <PanelLeftIcon />
        </Button>
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList>
            <BreadcrumbItem>
              <span className="text-muted-foreground">잔업제로</span>
            </BreadcrumbItem>
            {crumbs.map((c) => (
              <React.Fragment key={c.label}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border px-2 py-1">합성데이터</span>
        </div>
      </div>
    </header>
  )
}
