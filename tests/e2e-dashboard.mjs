/**
 * 대시보드 e2e — 개편(2026-09-04 10차) 판을 검사한다.
 *
 *   RND_TEST_ID=<아이디> RND_TEST_PW=<비밀번호> node tests/e2e-dashboard.mjs
 *
 * ⚠ 2026-09-04 로그인 게이트가 붙으면서 이 테스트도 막혔었다. 다른 e2e 들이
 *   쓰는 공용 로그인(tests/lib/login.mjs)을 그대로 가져다 쓴다 — 아이디·비밀번호는
 *   절대 이 파일에 적지 않는다(저장소가 공개다).
 */
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"

const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1500, height: 1080 },
})
const p = await b.newPage()
await p.setCacheEnabled(false)
const errs = []
p.on("pageerror", (e) => errs.push(String(e)))

const 잠깐 = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const H = process.env.HOME + "/work/"
const 카드제목 = () =>
  p.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent.trim()))
const 누르기 = (t) =>
  p.evaluate(
    (t) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t))?.click(),
    t,
  )

let 실패 = 0
const 확인 = (이름, 참, 값 = "") => {
  console.log(`${참 ? "  ok " : "  X  "} ${이름}${값 ? " : " + 값 : ""}`)
  if (!참) 실패++
}

try {
  await 로그인하고(p, BASE, "/dashboard")
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 })
  await p.screenshot({ path: H + "d0-full.png", fullPage: true })

  const 제목들 = await 카드제목()
  console.log("카드 :", 제목들.join(" · "))
  확인("공고 확인이 첫 카드", 제목들[0] === "공고 확인")
  확인("일정 카드 있음", 제목들.includes("일정"))
  확인("통합 관리 카드 있음 (수행 과제·사업 아님)", 제목들.includes("통합 관리"))
  확인("오늘 처리할 것 카드로 합쳐짐 (셋으로 안 쪼개짐)", 제목들.includes("오늘 처리할 것"))

  const 본문 = await p.evaluate(() => document.body.innerText)

  // 오늘 처리할 것 — 6차 개편: 갈래 전체 이름(비목 확정 등)은 이제 안 뜨고
  // 짧은 배지(대기·서류·점검)만 쓴다. 0건 갈래는 배지째로 아예 안 보인다.
  const 오늘카드 = await p.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "오늘 처리할 것")
    return h2?.closest("div.rounded-lg")?.textContent ?? ""
  })
  확인(
    "오늘 처리할 것 - 갈래 전체 이름은 안 뜨고 짧은 배지만 씀",
    !오늘카드.includes("비목 확정") && !오늘카드.includes("챙길 서류") && !오늘카드.includes("제출 전 점검"),
  )
  확인(
    "오늘 처리할 것 - 내용 또는 빈 상태 문구가 있음",
    ["대기", "서류", "점검"].some((v) => 오늘카드.includes(v)) || 오늘카드.includes("지금 손댈 것이 없습니다"),
    오늘카드.replace(/\s+/g, " ").trim().slice(0, 80),
  )
  // 7차 개편: 「외 N건」(안 눌리던 <p>) 이 없어지고 갈래별 페이지 넘김으로 바뀌었다.
  확인("오늘 처리할 것에 「외 N건」(안 눌리는 텍스트) 없음", !/외\s*\d+\s*건/.test(오늘카드))

  // 9차 개편: "없음"이 "처리할 게 없다"로 오독됐던 것 — 원래 값 대신 행동 문구로 바꿨다.
  // 「없음」이라는 원래 값이 카드 어디에도 그대로 노출되면 안 된다(전부 "발급 필요"로 바뀐다).
  확인("오늘 처리할 것에 원래 값 「없음」이 그대로 안 뜸(행동 문구로 바뀜)", !오늘카드.includes("없음"))
  if (오늘카드.includes("서류")) {
    확인(
      "챙길 서류 - 「발급 필요」(행동 문구)가 뜸",
      오늘카드.includes("발급 필요") || 오늘카드.includes("갱신 필요") || 오늘카드.includes("곧 만료"),
      오늘카드.replace(/\s+/g, " ").trim().slice(0, 100),
    )
  }
  if (오늘카드.includes("대기")) {
    확인("비목 확정 - 「확정 필요」(행동 문구)가 뜸", 오늘카드.includes("확정 필요"))
  }
  if (오늘카드.includes("점검") && !오늘카드.includes("지금 손댈 것이 없습니다")) {
    확인("제출 전 점검 - 「미해결 N건」(행동 문구)이 뜸", /미해결\s*\d+건/.test(오늘카드))
  }

  // 10차 개편: 갈래별 페이지 넘김을 버리고 카드 전체 통합 페이지 하나로 바꿨다.
  // ⚠ 버튼은 카드에 딱 하나만 있어야 한다(갈래마다 있던 것 없어짐).
  const 오늘카드정보 = () =>
    p.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "오늘 처리할 것")
      const card = h2?.closest("div.rounded-lg")
      return {
        버튼수: card?.querySelectorAll('button[aria-label$="다음 페이지"]').length ?? 0,
        첫줄: card?.querySelector("a")?.textContent.replace(/\s+/g, " ").trim() ?? null,
        높이: card?.getBoundingClientRect().height ?? null,
      }
    })
  const 정보전 = await 오늘카드정보()
  확인("오늘 처리할 것에 페이지 넘김 버튼이 있어도 하나뿐", 정보전.버튼수 <= 1, `버튼 ${정보전.버튼수}개`)

  if (정보전.버튼수 === 1) {
    await p.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "오늘 처리할 것")
      h2?.closest("div.rounded-lg")?.querySelector('button[aria-label$="다음 페이지"]')?.click()
    })
    await 잠깐(200)
    const 정보후 = await 오늘카드정보()
    확인(
      "오늘 처리할 것의 페이지 넘김 버튼이 실제로 목록을 바꿈(예전엔 <p>라 안 눌렸다)",
      정보전.첫줄 !== null && 정보후.첫줄 !== null && 정보전.첫줄 !== 정보후.첫줄,
      `${정보전.첫줄} → ${정보후.첫줄}`,
    )
    // 8차 개편: 마지막 페이지가 항목 수보다 적어도 빈 줄로 채워 카드 테두리가 안 움직여야 한다.
    확인(
      "페이지를 넘겨도 오늘 처리할 것 카드 테두리가 안 움직임(빈 줄로 채움)",
      정보전.높이 != null && 정보후.높이 != null && Math.abs(정보전.높이 - 정보후.높이) < 1,
      `${정보전.높이}px → ${정보후.높이}px`,
    )
  } else {
    console.log("  (오늘 처리할 것 항목이 5건 이하라 페이지 넘김 버튼이 안 뜸 - 정상)")
  }

  확인("부제 삭제됨", !본문.includes("오늘 손대야 할 것만 모았다"))
  확인("일간/주간/월간 전환 없음", !본문.includes("일간") && !본문.includes("주간"))
  확인("달력 접기 없음", !본문.includes("달력 접기") && !본문.includes("달력 펼치기"))
  확인("「미분류」가 화면에 안 보임", !본문.includes("미분류"))
  확인("마감된 공고 없음", !/\d{4}-\d{2}-\d{2}\s*마감/.test(본문))

  // 탭 2개(과제/지원사업)만 있는가 — 「기타」는 없앴다(자동 수집 출처 4개뿐, 실측)
  const 탭 = await p.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()),
  )
  console.log("공고 탭 :", 탭.slice(0, 2).join(" · "))
  // 탭 텍스트는 "과제" + 건수(예: "과제0")가 붙어 나온다. startsWith 로 본다.
  확인(
    "공고 탭 과제/지원사업 항상 보임",
    ["과제", "지원사업"].every((t) => 탭.some((x) => x.startsWith(t))),
  )
  확인("「기타」 탭 없음", !탭.some((x) => x.startsWith("기타")))

  // 공고 표 : 5줄 고정(빈 줄 포함) + 사업명이 상세로 링크
  const 표 = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")]
    const a = rows[0]?.querySelector("a[href]")
    return { 줄: rows.length, 첫링크: a?.getAttribute("href") ?? null }
  })
  확인("공고 5줄로 고정(빈줄 포함)", 표.줄 === 5, `${표.줄}줄`)
  확인(
    "사업명이 공고 상세로",
    /^\/(announcements|project-announcements)\/\d+$/.test(표.첫링크 ?? ""),
    표.첫링크 ?? "없음",
  )

  // 「가능만」 토글 버튼은 없앴다 — 목록 자체가 이미 가능 판정만 보여준다
  const 가능만있음 = await p.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith("가능만")),
  )
  확인("가능만 토글 버튼 없음", !가능만있음)

  // 표에 뜬 판정 배지가 전부 「가능」인가 — 불가·확인필요·요건미확인이 섞이면 안 된다
  const 판정배지들 = await p.evaluate(() =>
    [...document.querySelectorAll("tbody span")]
      .map((s) => s.textContent.trim())
      .filter((t) => ["가능", "불가", "확인필요", "요건미확인"].includes(t)),
  )
  console.log("표의 판정 배지 :", [...new Set(판정배지들)].join(", ") || "(없음)")
  확인(
    "표에 뜬 판정은 전부 가능",
    판정배지들.every((v) => v === "가능"),
    판정배지들.join(","),
  )

  const 전체공고확인 = await p.evaluate(() =>
    [...document.querySelectorAll("a")]
      .filter((a) => a.textContent.includes("전체 공고 확인"))
      .map((a) => a.getAttribute("href")),
  )
  console.log("전체 공고 확인 링크 :", 전체공고확인.join(", "))
  확인(
    "지원사업 탭의 「전체 공고 확인」이 지원사업 탐색으로",
    전체공고확인.includes("/announcements"),
  )

  await 누르기("과제")
  await 잠깐(300)
  const 전체공고확인_과제 = await p.evaluate(() =>
    [...document.querySelectorAll("a")]
      .filter((a) => a.textContent.includes("전체 공고 확인"))
      .map((a) => a.getAttribute("href")),
  )
  확인(
    "과제 탭에서는 「전체 공고 확인」이 과제 탐색으로 바뀜",
    전체공고확인_과제.includes("/project-announcements"),
    전체공고확인_과제.join(", "),
  )

  // 지원사업 탭에 자격판정 배지가 뜨는가(오늘 신규가 있을 때만 의미 있는 검사)
  const 배지있음 = await p.evaluate(() =>
    ["가능", "불가", "확인필요", "요건미확인"].some((v) => document.body.innerText.includes(v)),
  )
  console.log(`  (자격판정 배지 노출: ${배지있음})`)

  // 일정 — 오늘이 속한 달에서는 「오늘」 버튼이 안 보여야(invisible) 하고,
  // 달을 옮기면 나타나야 한다. 이때 가운데 월 표시가 옆으로 밀리면 안 된다(2026-09-03 지적).
  const 가운데중심 = () =>
    p.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "일정")
      const card = h2?.closest("div.rounded-lg")
      const label = card?.querySelector("span.tabular-nums")
      const r = label?.getBoundingClientRect()
      return r ? r.left + r.width / 2 : null
    })
  const 중심_오늘달 = await 가운데중심()
  const 오늘버튼숨김 = await p.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "오늘")
    return btn?.classList.contains("invisible") ?? false
  })
  확인("이번 달에서는 「오늘」 버튼이 숨어 있음(자리는 차지)", 오늘버튼숨김)

  await p.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "일정")
    const card = h2?.closest("div.rounded-lg")
    ;[...card.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "이전 달")?.click()
  })
  await 잠깐(300)
  const 중심_지난달 = await 가운데중심()
  const 오늘버튼보임 = await p.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "오늘")
    return btn ? !btn.classList.contains("invisible") : false
  })
  확인("달을 옮기면 「오늘」 버튼이 나타남", 오늘버튼보임)
  확인(
    "「오늘」 버튼이 나타나도 월 표시 위치가 안 밀림",
    중심_오늘달 != null && 중심_지난달 != null && Math.abs(중심_오늘달 - 중심_지난달) < 2,
    `${중심_오늘달} → ${중심_지난달}`,
  )
  await p.screenshot({ path: H + "d1-prevmonth.png", fullPage: true })

  // 날짜를 누르면 아래 목록이 그 날로 바뀌는가
  await p.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "일정")
    const card = h2?.closest("div.rounded-lg")
    card?.querySelector("button[aria-current='date'], button[aria-pressed]")?.click()
  })
  await 잠깐(300)

  // 통합 관리 — 상세 링크 + 오른쪽 날짜(연도 포함, D-day 없음) + 사업유형 배지
  const 과제카드 = await p.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "통합 관리")
    const card = h2?.closest("div.rounded-lg")
    const links = [...(card?.querySelectorAll('a[href^="/projects/"]') ?? [])]
    return {
      개수: links.length,
      첫줄: links[0]?.textContent.replace(/\s+/g, " ").trim() ?? null,
      본문: card?.textContent ?? "",
      전체보기: [...(card?.querySelectorAll("a") ?? [])]
        .filter((a) => a.textContent.includes("전체 보기"))
        .map((a) => a.getAttribute("href")),
    }
  })
  확인("통합 관리 목록이 상세로 링크", 과제카드.개수 > 0, `${과제카드.개수}개`)
  console.log(`  (첫 줄: ${과제카드.첫줄})`)
  확인("통합 관리에 D-day 없음", !/D-\d/.test(과제카드.본문))
  확인(
    "종료일이 연도까지 전체 표기(월.일만 아님)",
    /\d{4}-\d{2}-\d{2}/.test(과제카드.본문),
    과제카드.본문.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "없음",
  )
  확인(
    "사업유형 배지(과제/지원사업) 노출",
    과제카드.본문.includes("과제") || 과제카드.본문.includes("지원사업"),
  )
  확인(
    "탭별 「전체 보기」가 신청중/수행중 단계 경로로",
    과제카드.전체보기.every((h) => h === "/projects" || h === "/projects/applying"),
    과제카드.전체보기.join(", "),
  )

  // 페이지 넘김 줄이 페이지가 하나뿐이어도 항상 떠서 "1 / 1" 로 보이는가.
  // 신청중(적음, 보통 1페이지)·수행중(많음, 보통 2페이지)을 오가도 이 줄이 있다 없다
  // 하면 안 된다 — 그래서 탭을 바꾼 전후로 카드 높이가 같은지까지 같이 본다.
  const 과제카드높이 = () =>
    p.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "통합 관리")
      const card = h2?.closest("div.rounded-lg")
      const pager = [...(card?.querySelectorAll("span") ?? [])].find((s) => /^\d+ \/ \d+$/.test(s.textContent.trim()))
      return { 높이: card?.getBoundingClientRect().height ?? null, 페이지표기: pager?.textContent.trim() ?? null }
    })
  const 수행중상태 = await 과제카드높이()
  await p.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "통합 관리")
    const card = h2?.closest("div.rounded-lg")
    ;[...(card?.querySelectorAll('[role="tab"]') ?? [])].find((b) => b.textContent.trim().startsWith("신청중"))?.click()
  })
  await 잠깐(300)
  const 신청중상태 = await 과제카드높이()
  console.log(`  (수행중 페이지표기 ${수행중상태.페이지표기} · 신청중 페이지표기 ${신청중상태.페이지표기})`)
  // ⚠ 정확히 "1 / 1"을 기대하지 않는다 — 다른 팀원 테스트가 계속 데이터를 만들어서
  //   신청중 항목 수가 늘 수 있다(실측: 3건→6건). 확인할 건 "페이지 표기가 뜬다"는
  //   사실 자체지, 지금 이 순간의 건수가 아니다.
  확인("페이지 넘김 줄이 항상 뜸(건수 무관)", /^\d+ \/ \d+$/.test(신청중상태.페이지표기 ?? ""))
  확인(
    "탭을 바꿔도 통합 관리 카드 높이가 그대로",
    수행중상태.높이 != null && 신청중상태.높이 != null && Math.abs(수행중상태.높이 - 신청중상태.높이) < 1,
    `수행중 ${수행중상태.높이}px → 신청중 ${신청중상태.높이}px`,
  )

  // 왼쪽 달력 카드 세로 길이 == 오른쪽(통합 관리 + 오늘 처리할 것) 합계.
  // CSS Grid 의 items-stretch + flex-1 로 맞춘 것이라 픽셀이 완전히 같아야 한다 —
  // 몇 px 오차(테두리 반올림)는 봐주되 눈에 띄게 어긋나면 잡아낸다.
  const 높이대조 = await p.evaluate(() => {
    const h2 = (t) => [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === t)
    const 달력 = h2("일정")?.closest("div.rounded-lg")
    const 과제 = h2("통합 관리")?.closest("div.rounded-lg")
    const 오늘 = h2("오늘 처리할 것")?.closest("div.rounded-lg")
    if (!달력 || !과제 || !오늘) return null
    const 달력높이 = 달력.getBoundingClientRect().height
    const 오른쪽높이 = 오늘.getBoundingClientRect().bottom - 과제.getBoundingClientRect().top
    return { 달력높이, 오른쪽높이, 차이: Math.abs(달력높이 - 오른쪽높이) }
  })
  확인(
    "왼쪽 달력과 오른쪽(통합 관리+오늘 처리할 것) 세로 길이가 같음",
    높이대조 != null && 높이대조.차이 <= 2,
    높이대조 ? `달력 ${높이대조.달력높이}px / 오른쪽 ${높이대조.오른쪽높이}px (차이 ${높이대조.차이}px)` : "카드 못 찾음",
  )

  확인("콘솔 오류 없음", errs.length === 0, errs.join(" | "))

  const h = await p.evaluate(() => document.body.scrollHeight)
  console.log(`\n문서 높이 : ${h}px (1080 화면 기준 ${h > 1080 ? "스크롤 생김" : "한 화면"})`)
  console.log(실패 === 0 ? "\n전부 통과" : `\n실패 ${실패}건`)
} finally {
  await b.close()
}
process.exit(실패 === 0 ? 0 : 1)
