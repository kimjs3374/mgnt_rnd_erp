/**
 * 대시보드 e2e — 개편(2026-09-03 2차) 이후 판을 검사한다.
 *
 * 예전 tests/e2e-calendar.mjs 는 「일간·주간·월간」과 「달력 접기」를 눌렀는데
 * 그 버튼들이 없어졌다(달력이 배지형 월간 전용이 됐다). 그래서 이 파일로 대체한다.
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
  확인("수행 과제·사업 카드 있음", 제목들.includes("수행 과제·사업"))

  // 없어져야 하는 것들
  const 본문 = await p.evaluate(() => document.body.innerText)
  확인("부제 삭제됨", !본문.includes("오늘 손대야 할 것만 모았다"))
  확인("요약 줄 삭제됨", !/오늘 새 공고 \d+ ·/.test(본문))
  확인("NEW 배지 없음", !본문.includes("NEW"))
  확인("일간/주간/월간 전환 없음", !본문.includes("일간") && !본문.includes("주간"))
  확인("달력 접기 없음", !본문.includes("달력 접기") && !본문.includes("달력 펼치기"))
  확인("「미분류」가 화면에 안 보임", !본문.includes("미분류"))

  // 마감된 공고가 안 올라오는가
  확인("마감된 공고 없음", !/\d{4}-\d{2}-\d{2}\s*마감/.test(본문))

  // 「전체 보기」 링크가 카드마다 하나씩인가
  const 전체보기 = await p.evaluate(
    () => [...document.querySelectorAll("a")].filter((a) => a.textContent.includes("전체 보기")).length,
  )
  확인("전체 보기 링크 중복 없음 (카드당 1개)", 전체보기 <= 2, `${전체보기}개`)

  // 공고 표: 5줄 이하 + 사업명이 상세로 링크되는가
  const 표 = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")]
    const a = rows[0]?.querySelector("a[href]")
    return { 줄: rows.length, 첫링크: a?.getAttribute("href") ?? null }
  })
  확인("공고 5줄 이하", 표.줄 <= 5, `${표.줄}줄`)
  확인(
    "사업명이 공고 상세로",
    /^\/(announcements|project-announcements)\/\d+$/.test(표.첫링크 ?? ""),
    표.첫링크 ?? "없음",
  )

  // 달력 격자
  const 격자 = await p.evaluate(() => {
    const cell = document.querySelector('button[aria-current="date"]')
    const g = cell?.parentElement
    return { 열: g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0, 칸: g?.children.length ?? 0 }
  })
  확인("달력 7열", 격자.열 === 7, `${격자.열}열 ${격자.칸}칸`)

  // 날짜를 누르면 아래 목록이 그 날로 바뀌는가
  await p.evaluate(() => document.querySelector('button[aria-current="date"]')?.click())
  await 잠깐()
  const 누른뒤 = await p.evaluate(() => document.body.innerText)
  확인("날짜 클릭이 목록을 바꿈", /\d+월 \d+일/.test(누른뒤))
  await p.screenshot({ path: H + "d1-day.png", fullPage: true })

  // 수행 과제 탭
  const 과제링크 = await p.evaluate(
    () => [...document.querySelectorAll('a[href^="/projects/"]')].length,
  )
  확인("수행 과제가 상세로 링크", 과제링크 > 0, `${과제링크}개`)

  확인("콘솔 오류 없음", errs.length === 0, errs.join(" | "))

  const h = await p.evaluate(() => document.body.scrollHeight)
  console.log(`\n문서 높이 : ${h}px (1080 화면 기준 ${h > 1080 ? "스크롤 생김" : "한 화면"})`)
  console.log(실패 === 0 ? "\n전부 통과" : `\n실패 ${실패}건`)
} finally {
  await b.close()
}
process.exit(실패 === 0 ? 0 : 1)
