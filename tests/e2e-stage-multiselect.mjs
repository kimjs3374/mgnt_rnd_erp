// 과제 관리 전체 화면 — 단계 필터가 **여러 개 동시에** 켜지는지.
//
// 「신청중이랑 수행중만」처럼 셋 중 둘을 동시에 보는 것이 이번 요청의 핵심이다.
// 드롭다운(하나만 고름)에서 토글 칩(여러 개 동시에 켬)으로 바뀐 것을 실제 클릭으로 확인한다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말, 곁 = "") => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}${곁 ? ` — ${곁}` : ""}`)
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1400"],
  defaultViewport: { width: 1440, height: 1400 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
// ⚠ `page.evaluate` 는 DOM 엘리먼트를 Node 쪽으로 못 들고 나온다(직렬화된다). 두 번의
//   evaluate 로 나눠 「찾기」와 「누르기」를 하면 두 번째 evaluate 에는 진짜 버튼이 아니라
//   빈 값이 건네져서 클릭이 조용히 아무 일도 안 한다. **한 evaluate 안에서 찾고 바로 누른다.**
const 칩누르기 = (이름) =>
  page.evaluate((n) => {
    const b = [...document.querySelectorAll('[role="group"][aria-label="단계로 걸러내기"] button')].find(
      (x) => x.textContent.trim() === n,
    )
    if (!b) return false
    b.click()
    return true
  }, 이름)

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()

  const 눌린 = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role="group"][aria-label="단계로 걸러내기"] button[aria-pressed="true"]')]
        .map((b) => b.textContent.trim()),
    )

  확인(text.includes("신청중") && text.includes("수행중") && text.includes("사업종료"), "칩 세 개가 다 있다")
  확인((await 눌린()).length === 3, "기본은 셋 다 켜져 있다(=전체)")

  const 전체행 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)

  // 「사업종료」만 끈다 — 신청중 + 수행중 두 개가 동시에 켜진 상태가 되는지 본다.
  확인(await 칩누르기("사업종료"), "「사업종료」 칩을 누른다")
  await 잠깐(400)
  확인(
    JSON.stringify((await 눌린()).sort()) === JSON.stringify(["수행중", "신청중"].sort()),
    "사업종료만 꺼도 신청중·수행중 둘은 그대로 켜져 있다(동시 선택)",
  )
  text = await 본문()
  확인(!text.includes("문제가 있다는 뜻이 아닙니다"), "종료 줄이 빠지니 종료 범례도 사라진다")
  const 두단계행 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  확인(두단계행 < 전체행 && 두단계행 > 0, `종료를 끄니 ${전체행}행 → ${두단계행}행으로 줄었다`)

  const 표에보이는상태 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td:nth-child(2)")?.textContent?.trim(),
    ),
  )
  확인(
    표에보이는상태.every((s) => s === "신청중" || s === "수행중"),
    "표에 남은 줄은 전부 신청중 아니면 수행중이다",
    표에보이는상태.join(","),
  )

  // 신청중까지 끄면 수행중 하나만 남는다.
  확인(await 칩누르기("신청중"), "「신청중」 칩도 마저 끈다")
  await 잠깐(400)
  const 표에보이는상태2 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td:nth-child(2)")?.textContent?.trim(),
    ),
  )
  확인(표에보이는상태2.every((s) => s === "수행중"), "신청중까지 끄면 수행중만 남는다")

  // 초기화하면 셋 다 다시 켜진다.
  const 초기화버튼 = await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("초기화")) != null,
  )
  확인(초기화버튼, "필터가 걸리면 초기화 버튼이 뜬다")
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("초기화"))
    b?.click()
  })
  await 잠깐(400)
  확인((await 눌린()).length === 3, "초기화하면 단계 칩도 셋 다 다시 켜진다")
  const 복구행 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  확인(복구행 === 전체행, `초기화 후 ${복구행}행 (원래 ${전체행}행)`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
