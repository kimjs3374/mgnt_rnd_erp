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
      // 공고 탐색 다음에 둔다. 일의 순서가 그렇다 —
      // 공고를 보고 → 지원해서 선정되면 → 여기서 사업비를 잡고 → 그 결과가 「과제 관리」에 쌓인다.
      { title: "과제 계상", url: "/project-budgeting" },
    ],
  },
  {
    // ⚠ 「사업 대장」 하나였던 것을 **단계 셋**으로 나누고(2026-09-03), 그 셋을 **따로 묶었다**
    //    (2026-09-04 사용자 지시). 한 표에 신청·수행·종료가 섞여 있으면 「지금 뭘 해야 하나」가
    //    안 보인다 — 신청중은 결과를 기다리는 일, 수행중은 돈을 쓰는 일, 종료는 정산·보고가 남은 일이라
    //    할 일의 성격이 아예 다르다. 그래서 화면도 그룹도 나눈다.
    //
    //    이름을 **「과제 관리」**로 했다. 사용자가 「과제수행 또는 관리」라고 했는데
    //    **신청중은 아직 수행이 아니다** — 셋을 아우르는 말은 관리 쪽이다.
    //
    //    단계는 **저장하지 않고 계산한다**(`lib/project-stage.ts`) — 그래야 선정을 기록하는 순간
    //    수행중으로, 수행기간이 지나면 사업종료로 저절로 넘어간다.
    title: "과제 관리",
    // 그룹 이름을 누르면 첫 항목으로 간다(위 두 그룹과 같은 규칙).
    url: "/projects/applying",
    // ⚠ 아이콘은 `components/app-sidebar.tsx` 의 ICONS 에 **이미 있는 것**만 쓴다.
    //    없는 이름을 적으면 아이콘이 조용히 안 그려진다.
    icon: "ClipboardCheck",
    items: [
      { title: "신청중", url: "/projects/applying" },
      // `/projects` 는 그대로 둔다 — 과제 상세(`/projects/[id]`)의 부모이고 여러 화면·테스트가
      // 이 주소를 가리킨다. 나머지 둘은 정적 조각이라 `[id]` 보다 먼저 잡힌다.
      { title: "수행중", url: "/projects" },
      { title: "사업종료", url: "/projects/closed" },
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
      // 업체(거래처) 대장 — 사업자등록증·통장사본처럼 **업체에서 받아 두는** 서류의 자리다.
      // 위 셋과 같은 층에 둔다: 회사 프로필(우리 정보) · 서류함(우리가 내는 서류) ·
      // 규정 문서함(받는 규정) · 업체(업체에서 받는 서류). 넷 다 **과제보다 위**에 있고
      // 여러 과제가 같은 것을 쓴다. 과제 안에 두면 같은 등록증을 건마다 다시 받게 된다.
      { title: "업체", url: "/vendors" },
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
      // 과제 상세의 부모는 이제 「과제 관리 > 수행중」이다(2026-09-04 그룹을 나눴다).
      { label: "과제 관리", href: "/projects" },
      { label: "과제" },
      ...(tab && tab.seg ? [{ label: tab.title }] : []),
    ]
  }

  // 공고 상세(사업명 클릭)도 공고마다 id 가 달라 NAV 에 없다 — 목록 쪽 라벨을 그대로 쓴다.
  const ann = /^\/(announcements|project-announcements)\/\d+$/.exec(pathname)
  if (ann) {
    const listPath = "/" + ann[1]
    for (const g of NAV) {
      const leaf = g.items?.find((i) => i.url === listPath)
      if (leaf) return [{ label: g.title, href: listPath }, { label: leaf.title, href: listPath }, { label: "공고 상세" }]
    }
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
