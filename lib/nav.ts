// 사이드바 · 브레드크럼의 단일 진실.
// 화면을 추가할 때 여기만 고치면 사이드바와 브레드크럼이 같이 따라온다.

export type NavLeaf = { title: string; url: string }
export type NavGroup = {
  title: string
  url: string
  icon: string // lucide 아이콘 이름
  items?: NavLeaf[]
}

/**
 * ⚠ 집행 · 예산 · 정산은 최상위에 두지 않는다. **과제 하나 안으로 들어갔다.**
 *
 * 최상위에 있으면 여러 과제가 한 표에 합쳐지는데, 그 숫자는 뜻이 없다 —
 * 합친 소진율은 배정 20.7억 대 집행 2,262만 = 1.1% 였다.
 * 무엇보다 **한도가 과제마다 다르다.** 연구수당 한도는 그 과제의 수정인건비로,
 * 간접비 한도는 그 과제의 직접비로 정해진다. 합치면 계산 자체가 성립하지 않는다.
 *
 * 그래서 과제사업 → 사업 대장 → 과제를 열면 그 안에 개요 · 연구비 계상 · 집행 · 정산이 있다.
 * 돈은 과제 단위로 계상하고, 과제 단위로 쓰고, 과제 단위로 정산한다.
 *
 * ⚠ **지원사업·과제사업 둘 다 「공고 탐색」이 먼저고 「사업 대장」이 그 아래다.** 일이
 *   공고에서 시작하기 때문이다 — 공고를 보고 → 자격을 판정하고 → 신청해서 선정되면 →
 *   그때 대장에 사업/과제가 생긴다(CLAUDE.md §0.5 의 흐름: 공고 → 자격판정 → 신청 →
 *   선정 → 협약 → 집행 → 보고). 메뉴 순서가 그 순서와 반대면, 화면이
 *   「이미 하고 있는 사업/과제 관리」로만 읽힌다. (2026-09-03 지원사업도 과제사업과
 *   순서를 맞췄다 — 원래는 지원사업만 사업 대장이 먼저였다.)
 */
export const NAV: NavGroup[] = [
  { title: "대시보드", url: "/dashboard", icon: "LayoutDashboard" },
  {
    title: "지원사업",
    // 그룹 이름을 누르면 첫 항목(공고 탐색)으로 간다.
    url: "/announcements",
    icon: "FolderKanban",
    items: [
      { title: "공고 탐색", url: "/announcements" },
      { title: "사업 대장", url: "/programs" },
    ],
  },
  {
    title: "과제사업",
    // 그룹 이름을 누르면 첫 항목(공고 탐색)으로 간다. 순서와 어긋나면 사용자가 헷갈린다.
    // 지원사업과 항목 순서를 맞춘다 — 나란히 놓인 두 그룹이 서로 다른 순서면
    // 매번 어느 쪽이 어디 있는지 다시 읽어야 한다.
    url: "/project-announcements",
    icon: "Briefcase",
    items: [
      { title: "공고 탐색", url: "/project-announcements" },
      { title: "사업 대장", url: "/projects" },
    ],
  },
  {
    title: "회사",
    url: "/company",
    icon: "Building2",
    items: [
      { title: "회사 프로필", url: "/company" },
      { title: "서류함", url: "/documents" },
      // 서류함은 **우리가 내는** 서류(등기부·재무제표)고, 규정 문서함은 **받는** 것이다
      // (공고문·관리지침·사용기준). 둘 다 보관이라 같은 그룹에 두되 이름으로 갈라 둔다.
      { title: "규정 문서함", url: "/rules" },
    ],
  },
]

/** 과제 상세 하위 경로 → 탭 이름. 브레드크럼과 ProjectTabs 가 같은 표를 본다. */
export const PROJECT_TABS: { seg: string; title: string }[] = [
  { seg: "", title: "개요" },
  { seg: "budget", title: "연구비 계상" },
  { seg: "expenses", title: "집행" },
  { seg: "settlement", title: "정산" },
]

/** 경로 → 브레드크럼 조각. 사이드바 정의에서 역으로 만든다. */
export function crumbsFor(pathname: string): { label: string; href?: string }[] {
  // 과제 상세는 NAV 에 없다(과제마다 경로가 다르므로). 경로 모양으로 판단한다.
  const m = /^\/projects\/(\d+)(?:\/([a-z-]+))?$/.exec(pathname)
  if (m) {
    const tab = PROJECT_TABS.find((t) => t.seg === (m[2] ?? ""))
    return [
      { label: "과제사업", href: "/projects" },
      { label: "과제" },
      ...(tab && tab.seg ? [{ label: tab.title }] : []),
    ]
  }

  for (const g of NAV) {
    if (g.items) {
      const leaf = g.items.find((i) => i.url === pathname)
      if (leaf) return [{ label: g.title }, { label: leaf.title }]
    }
    if (g.url === pathname) return [{ label: g.title }]
  }
  return [{ label: "잔업제로" }]
}
