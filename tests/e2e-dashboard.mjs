/**
 * 대시보드 e2e — 개편(2026-09-03 3차) 판을 검사한다.
 *
 *   node tests/e2e-dashboard.mjs
 */
import puppeteer from "puppeteer-core"

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
  await p.goto("http://127.0.0.1:3610/dashboard", { waitUntil: "networkidle0", timeout: 60000 })
  await p.screenshot({ path: H + "d0-full.png", fullPage: true })

  const 제목들 = await 카드제목()
  console.log("카드 :", 제목들.join(" · "))
  확인("공고 확인이 첫 카드", 제목들[0] === "공고 확인")
  확인("일정 카드 있음", 제목들.includes("일정"))
  확인("과제 관리 카드 있음 (수행 과제·사업 아님)", 제목들.includes("과제 관리"))

  // 큐 카드 제목은 <h2> 가 아니라 링크다. 본문 텍스트로 확인한다.
  const 본문 = await p.evaluate(() => document.body.innerText)
  확인("비목 확정 카드 있음", 본문.includes("비목 확정"))
  확인("챙길 서류 카드 있음 (빠진 서류 아님)", 본문.includes("챙길 서류") && !본문.includes("빠진 서류"))
  확인("제출 전 점검 카드 있음", 본문.includes("제출 전 점검"))
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

  // 과제 관리 — 상세 링크 + 오른쪽 날짜(연도 포함, D-day 없음) + 사업유형 배지
  const 과제카드 = await p.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "과제 관리")
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
  확인("과제 관리 목록이 상세로 링크", 과제카드.개수 > 0, `${과제카드.개수}개`)
  console.log(`  (첫 줄: ${과제카드.첫줄})`)
  확인("과제 관리에 D-day 없음", !/D-\d/.test(과제카드.본문))
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

  확인("콘솔 오류 없음", errs.length === 0, errs.join(" | "))

  const h = await p.evaluate(() => document.body.scrollHeight)
  console.log(`\n문서 높이 : ${h}px (1080 화면 기준 ${h > 1080 ? "스크롤 생김" : "한 화면"})`)
  console.log(실패 === 0 ? "\n전부 통과" : `\n실패 ${실패}건`)
} finally {
  await b.close()
}
process.exit(실패 === 0 ? 0 : 1)
