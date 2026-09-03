import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "잔업제로 — 지원사업 관리",
  description:
    "정부·지자체 지원사업의 공고부터 정산까지, 판단 근거와 함께 쌓는다.",
}

// 웹폰트를 외부에서 불러오지 않는다. 대회장 네트워크가 막히면 발표 중에 글꼴이 깨진다.
// 시스템 폰트 스택으로 간다 (UI레퍼런스.md §1 폴백 순서).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
