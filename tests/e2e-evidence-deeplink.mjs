// 증빙 딥링크 + 정산 D-day.
//
//   ① 배지가 **그 과제의 그 집행 건**으로 간다(`?expense=<id>`), 가장 오래된 빈 건부터
//   ② 그 주소로 가면 **상세가 열린 채**로 뜬다 — 어디가 비었는지 바로 보인다
//   ③ 정산 마감 카드에 D-day 와 실제 날짜·요일이 적힌다
//   ④ 25일이 주말·공휴일이면 당겨졌다고 이유를 말한다
//
// 읽기만 한다. 아무것도 안 바꾼다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}`)
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1300"],
  defaultViewport: { width: 1700, height: 1300 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

await 로그인하고(page, BASE)

try {
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 700))

  // ① 배지 → 집행 건 딥링크
  const 배지 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody a")]
      .filter((a) => a.textContent.trim().startsWith("증빙"))
      .map((a) => ({ 글: a.textContent.trim(), href: a.getAttribute("href") ?? "" })),
  )
  확인(배지.length > 0, `증빙 배지가 있다 (${배지.map((b) => b.글).join(" · ")})`)
  확인(
    배지.every((b) => /\/projects\/\d+\/expenses\?expense=\d+$/.test(b.href)),
    `배지가 **그 집행 건**으로 간다 (${배지[0]?.href})`,
  )

  // ② 그 주소로 가면 상세가 열려 있다
  await page.goto(`${BASE}${배지[0].href}`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 900))
  const 상세 = await page.evaluate(
    () => document.querySelector('[data-slot="dialog-content"]')?.innerText ?? "",
  )
  확인(상세.length > 0, "그 집행 건의 상세가 열린 채로 뜬다")
  확인(상세.includes("증빙 서류"), "증빙 서류 칸이 보인다")
  const 미확보 = /미확보 (\d+)건/.exec(상세)
  확인(!!미확보, `무엇이 비었는지 건수로 말해 준다 (${미확보?.[0] ?? "없음"})`)
  확인(
    ["구매의뢰서", "지출결의서", "거래명세서", "세금계산서", "검수조서"].every((s) =>
      상세.includes(s),
    ),
    "필수 5종이 다 보인다",
  )

  // ③④ 정산 마감 카드
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 700))
  const 글 = await page.evaluate(() => document.body.innerText)
  확인(글.includes("이번 정산 마감"), "정산 마감 카드가 있다")
  const dday = /D-(\d+)|이번 정산 마감\s*\n?\s*오늘/.exec(글)
  확인(!!dday, `D-day 가 적혀 있다 (${dday?.[0] ?? "없음"})`)
  const 날 = /\d{4}-\d{2}-\d{2}\([일월화수목금토]\)/.exec(글)
  확인(!!날, `실제 날짜와 요일을 같이 적는다 (${날?.[0] ?? "없음"}) — 눈으로 검산할 수 있어야 한다`)
  확인(글.includes("매월 25일"), "기준이 매월 25일이라고 밝힌다")
  if (글.includes("앞 영업일로")) {
    log(`· 이번 달은 당겨졌다: ${/25일이 \S+라 앞 영업일로/.exec(글)?.[0] ?? ""}`)
  }
  if (글.includes("음력 공휴일 확인 필요")) {
    log("· 음력 공휴일이 끼어 「확인 필요」를 띄우고 있다(설·부처님오신날·추석)")
  }

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
