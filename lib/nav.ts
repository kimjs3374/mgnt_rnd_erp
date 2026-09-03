// 사이드바 · 브레드크럼의 단일 진실.
// 화면을 추가할 때 여기만 고치면 사이드바와 브레드크럼이 같이 따라온다.

export type NavLeaf = { title: string; url: string }
export type NavGroup = {
  title: string
  url: string
  icon: string // lucide 아이콘 이름
  items?: NavLeaf[]
}

export const NAV: NavGroup[] = [
  { title: "대시보드", url: "/dashboard", icon: "LayoutDashboard" },
  {
    title: "지원사업",
    url: "/programs",
    icon: "FolderKanban",
    items: [
      { title: "사업 대장", url: "/programs" },
      { title: "공고 탐색", url: "/announcements" },
    ],
  },
  { title: "과제사업", url: "/projects", icon: "Briefcase" },
  { title: "집행", url: "/expenses", icon: "ReceiptText" },
  { title: "예산", url: "/budget", icon: "PieChart" },
  { title: "정산", url: "/settlement", icon: "ClipboardCheck" },
  {
    title: "회사",
    url: "/company",
    icon: "Building2",
    items: [
      { title: "회사 프로필", url: "/company" },
      { title: "서류함", url: "/documents" },
    ],
  },
]

/** 경로 → 브레드크럼 조각. 사이드바 정의에서 역으로 만든다. */
export function crumbsFor(pathname: string): { label: string; href?: string }[] {
  for (const g of NAV) {
    if (g.items) {
      const leaf = g.items.find((i) => i.url === pathname)
      if (leaf) return [{ label: g.title }, { label: leaf.title }]
    }
    if (g.url === pathname) return [{ label: g.title }]
  }
  return [{ label: "잔업제로" }]
}
