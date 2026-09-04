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
      // 관리 화면은 **그 사업축 아래**에 둔다(2026-09-04 사용자 지시로 「통합 관리」 그룹에서
      // 되돌아왔다). 일이 공고에서 시작해 그 축 안에서 이어지므로 따라가기 쉽다.
      // ⚠ 단계(신청중·수행중·사업종료)는 **메뉴로 늘어놓지 않는다** — 한 번 그렇게 했다가
      //   "뭔가 이상하게 만들고 있다"는 지적을 받고 되돌렸다. 들어가면 화면 안에 칩이 있다
      //   (`components/programs-stage-view.tsx`).
      { title: "지원사업 관리", url: "/programs" },
      // 서류함 — 계상 증빙·집행 증빙·정산 서류가 각각 다른 표에 들어가는데, **보는 자리**는
      // 하나여야 한다(2026-09-04 사용자 지시). 올리는 자리는 그대로 둔다: 놓는 자리가
      // 곧 서류종류라 여기서 또 받으면 「무엇에 붙은 파일인가」가 사라진다.
      // ⚠ 회사 > 서류함(/documents)과 이름이 같아서 헷갈린다는 지적을 받고
      //   「지원사업 서류함」으로 이름을 나눴다(2026-09-04). 그쪽은 **우리 회사** 서류
      //   (등기부·재무제표)고, 이쪽은 **사업에 붙은** 서류다.
      { title: "지원사업 서류함", url: "/programs/files" },
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
      // 지원사업 그룹과 **같은 순서**다 — 나란히 놓인 두 그룹이 서로 다르면 매번 다시 읽어야 한다.
      { title: "과제 관리", url: "/projects/all" },
      // 지원사업 서류함(위 지원사업 그룹)과 같은 화면·같은 조회다 — 어느 사업유형까지
      // 셀지만 다르다(`getProgramFiles(true)`, 2026-09-04 사용자 지시).
      { title: "과제사업 서류함", url: "/projects/files" },
      // ⚠ 「업체」는 사이드바에 없다(2026-09-04 사용자 지시) — **과제사업 서류함 안의 탭**
      //   으로 들어갔다(`/projects/files?tab=vendors`). 정산 때 서류를 챙기는 사람이
      //   과제 서류와 업체 서류를 같이 찾는데, 메뉴를 갈라 두면 매번 오간다.
      //   `/vendors` 주소는 살려 뒀다(북마크·e2e) — 「연구원」과 같은 처리다.
      // 「연구원」은 사이드바에 없다(2026-09-04) — 명부는 **인건비 계상 안**에서 관리한다.
      //   명부는 인건비 표에 이름을 넣기 위한 재료라, 메뉴가 갈리면 「등록 → 이동 → 복귀 →
      //   골라 넣기」 네 걸음이 된다. `/researchers` 주소는 살려 뒀다(북마크·e2e).
      // ⚠ 「과제 계상」(/project-budgeting) 은 없앴다(2026-09-04). 총사업비 입력은
      //   연구비 계상 탭의 재원 구성 카드 안으로 들어갔다 — 화면을 하나 더 두지 않는다.
      // ⚠ 이 줄이 한 번 되살아난 적이 있다. 화면을 지운 뒤 다른 커밋이 nav.ts 를
      //   **통째로 덮으면서** 링크만 남아 메뉴에서 없는 화면으로 갔다.
      //   이 파일은 전체를 덮어쓰지 말고 필요한 줄만 고친다.
    ],
  },
  {
    // 판정 리포트 — 지원사업·과제사업을 통틀어 **규칙 엔진이 무엇을 어떻게 걸렀는지**를
    // 정량으로 보여주고, 접힌 것을 사람이 되돌리는 화면(2026-09-04 사용자 요청).
    // 두 사업축에 걸쳐 있어 어느 한쪽 그룹 밑에 두지 않고 최상위에 둔다.
    // 부서 무관 공용이라 lib/access.ts 에 접두사를 추가하지 않는다(기본이 허용).
    title: "판정 리포트",
    url: "/engine",
    // ⚠ 아이콘은 components/app-sidebar.tsx 의 ICONS 에 이미 있는 것만 쓴다.
    icon: "PieChart",
  },
  {
    title: "회사",
    url: "/company",
    icon: "Building2",
    items: [
      { title: "회사 프로필", url: "/company" },
      { title: "서류함", url: "/documents" },
      // ⚠ 「규정 문서함」(/rules)은 2026-09-04 사용자 지시로 지웠다. 표 app.rule_documents 와
      //   올라가 있던 규정 원문 4건은 **남아 있다** — 화면만 없앴다. 되살릴 일이 생기면
      //   db/98_rule_documents.sql 과 커밋 이력을 보면 된다.
      // ⚠ 「서류 올린 기록」(/uploads)은 2026-09-04 사용자 지시로 지웠다 —
      //   **로그는 Slack 으로 받기로 했다.** 화면을 또 두면 볼 자리가 둘이 된다.
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
    "/projects/applied": { 부모: "과제 관리", 부모경로: "/projects/all", 이름: "신청완료" },
    "/projects": { 부모: "과제 관리", 부모경로: "/projects/all", 이름: "수행중" },
    "/projects/closed": { 부모: "과제 관리", 부모경로: "/projects/all", 이름: "사업종료" },
    "/programs/applying": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "신청중" },
    "/programs/applied": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "신청완료" },
    "/programs/executing": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "수행중" },
    "/programs/closed": { 부모: "지원사업 관리", 부모경로: "/programs", 이름: "사업종료" },
  }
  if (pathname in 단계경로표) {
    const s = 단계경로표[pathname]
    // 부모 그룹 이름은 NAV 에서 찾는다 — 여기 문자열을 박아 두면 그룹 이름이 바뀔 때
    // 브레드크럼만 옛 이름으로 남는다(실제로 "통합 관리"가 그렇게 남아 있었다).
    const 그룹 = NAV.find((g) => g.items?.some((i) => i.url === s.부모경로))
    return [
      ...(그룹 ? [{ label: 그룹.title }] : []),
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
