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
      // ⚠ 「사업 대장」(지원사업 관리)은 여기 없다 — **통합 관리 그룹으로 옮겼다**
      //   (2026-09-04 사용자 지시: 과제 관리·지원사업 관리를 한 그룹에 모아 놓고, 각각의
      //   상세 화면 안에서 신청중·수행중·사업종료를 본다. 처음엔 이 그룹 밑에 넣고 단계
      //   셋도 사이드바에 따로 늘어놓았는데 — "뭔가 이상하게 만들고 있다"는 지적을 받고
      //   되돌렸다. 단계는 메뉴로 늘어놓지 않는다, 상세 화면의 칩(전체/신청중/수행중/
      //   사업종료)이 이미 그 일을 한다(`components/programs-stage-view.tsx`).
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
      // ⚠ 「과제 계상」(/project-budgeting) 은 없앴다(2026-09-04). 총사업비 입력은
      //   연구비 계상 탭의 재원 구성 카드 안으로 들어갔다 — 화면을 하나 더 두지 않는다.
      // ⚠ 이 줄이 한 번 되살아난 적이 있다. 화면을 지운 뒤 다른 커밋이 nav.ts 를
      //   **통째로 덮으면서** 링크만 남아 메뉴에서 없는 화면으로 갔다.
      //   이 파일은 전체를 덮어쓰지 말고 필요한 줄만 고친다.
    ],
  },
  {
    // ⚠ 2026-09-04 사용자 지시로 다시 짰다 — 「과제 관리」였던 그룹을 **「통합 관리」**로
    //    바꾸고, 지원사업·과제사업 각각의 관리 화면(예전 「사업 대장」·「전체」)을 **이 한
    //    그룹 아래로 모았다.** 처음엔 신청중·수행중·사업종료도 사이드바에 따로 늘어놓았는데
    //    "뭔가 이상하게 만들고 있다"는 지적을 받고 되돌렸다 — **단계는 메뉴 항목이 아니라
    //    상세 화면 안의 칩**이다. 「과제 관리」(`/projects/all`)도 「지원사업 관리」
    //    (`/programs`)도 들어가면 전체/신청중/수행중/사업종료 칩이 이미 있다
    //    (`components/projects-stage-view.tsx`·`components/programs-stage-view.tsx`).
    //    사이드바 leaf 는 딱 그 두 개(과제 관리·지원사업 관리)뿐이다.
    //
    //    단계는 여전히 **저장하지 않고 계산한다**(`lib/project-stage.ts`) — 선정을 기록하는 순간
    //    수행중으로, 수행기간이 지나면 사업종료로 저절로 넘어간다. 이건 안 바뀌었다.
    title: "통합 관리",
    // 그룹 이름을 누르면 첫 항목(지원사업 관리)으로 간다.
    // ⚠ 2026-09-04 순서 변경(사용자 지시) — 지원사업이 먼저다. CLAUDE.md 의 "지원사업이
    //   중심, R&D 는 그중 한 유형" 원칙과 같은 이유로 두 leaf 의 순서도 맞춘다.
    url: "/programs",
    // ⚠ 아이콘은 `components/app-sidebar.tsx` 의 ICONS 에 **이미 있는 것**만 쓴다.
    //    없는 이름을 적으면 아이콘이 조용히 안 그려진다.
    icon: "ClipboardCheck",
    items: [
      { title: "지원사업 관리", url: "/programs" },
      { title: "과제 관리", url: "/projects/all" },
      // 내부 연구원 명부. 단계와 성격이 달라(「어디까지 왔나」 대 「누가 있나」) 별도 항목이다.
      // ⑥ 「연구원」을 사이드바에서 뺐다(2026-09-04 사용자 지시) — 명부는 인건비 계상 안에서
      //    관리한다(`app/(app)/projects/[id]/budget/page.tsx`). 명부는 인건비 표에 이름을 넣기
      //    위한 재료라서, 메뉴가 갈려 있으면 「등록 → 이동 → 복귀 → 골라 넣기」 네 걸음이 된다.
      //    `/researchers` 주소는 살려 뒀다 — 북마크와 e2e 가 그 주소를 가리킨다.
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
  {
    // 2026-09-04 로그인 도입과 함께 추가. 슈퍼관리자(role=super_admin)에게만 보인다
    // (components/app-sidebar.tsx 에서 userRole 로 필터). 여기서는 항상 넣어 둔다 —
    // 안 그러면 /admin/users 브레드크럼(crumbsFor)이 이 항목을 못 찾는다.
    // ⚠ title을 "관리자"로 두지 않는다 — "관리자"는 이제 역할 등급 이름(슈퍼관리자>관리자>일반회원)
    //   이라 메뉴 이름과 겹치면 헷갈린다. "계정 관리"로 분리한다.
    title: "계정 관리",
    url: "/admin/users",
    icon: "ShieldCheck",
    items: [{ title: "계정 승인", url: "/admin/users" }],
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
      // NAV leaf 이름이 「과제 관리」다(2026-09-04, 통합 관리 그룹 안) — 부모도 그 주소를 가리킨다.
      { label: "과제 관리", href: "/projects/all" },
      { label: "과제" },
      ...(tab && tab.seg ? [{ label: tab.title }] : []),
    ]
  }

  // 단계 필터 페이지(신청중·수행중·사업종료) — 사이드바 메뉴가 아니라 상세 화면 안의
  // 칩으로만 들어온다(2026-09-04, 위 NAV 주석 참고). NAV 에 leaf 가 없어 아래 공용 루프가
  // 못 찾으므로, 여기서 먼저 짚어 준다. 이름은 `lib/project-stage.ts`·`lib/program-stage.ts`의
  // 단계정의를 그대로 쓴다(다른 데서 이미 검증된 이름과 다시 어긋나지 않게).
  const 단계경로표: Record<string, { 부모: string; 부모경로: string; 이름: string }> = {
    "/projects/applying": { 부모: "과제 관리", 부모경로: "/projects/all", 이름: "신청중" },
    "/projects": { 부모: "과제 관리", 부모경로: "/projects/all", 이름: "수행중" },
    "/projects/closed": { 부모: "과제 관리", 부모경로: "/projects/all", 이름: "사업종료" },
    "/programs/applying": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "신청중" },
    "/programs/executing": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "수행중" },
    "/programs/closed": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "사업종료" },
  }
  if (pathname in 단계경로표) {
    const s = 단계경로표[pathname]
    return [
      { label: "통합 관리" },
      { label: s.부모, href: s.부모경로 },
      { label: s.이름 },
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
