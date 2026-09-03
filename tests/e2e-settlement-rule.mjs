// 정산 마감을 **사람이 바꿀 수 있는가.** (2026-09-04 사용자 지시: 회계 일정은 매번 달라진다)
//
//   ① 카드에 D-day·날짜·요일·규칙이 적혀 있다
//   ② 「편집」으로 기준일을 바꾸면 마감일이 따라 바뀐다
//   ③ 「이 달만 적용」이 규칙을 이긴다
//   ④ 「규칙대로」로 되돌린다
//   ⑤ 끝나면 원래 규칙(25일·앞)으로 되돌려 놓는다 — 시연 화면을 바꿔 놓지 않는다
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

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 본문 = () => page.evaluate(() => document.body.innerText)
/** 카드에 적힌 마감일. */
const 마감일 = async () => (/(\d{4}-\d{2}-\d{2})\([일월화수목금토]\)/.exec(await 본문()) ?? [])[1] ?? null
const 열기 = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "편집")
    b?.click()
    return !!b
  })
const 채우기 = (label, v) =>
  page.evaluate(
    ({ label, v }) => {
      const el = [...document.querySelectorAll("input")].find(
        (i) => i.getAttribute("aria-label") === label,
      )
      if (!el) return false
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      s.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    },
    { label, v },
  )
const 누르기 = (글) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t)
    b?.click()
    return !!b
  }, 글)
const 가기 = async () => {
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
}

try {
  await 가기()

  // ①
  const 처음 = await 마감일()
  const 글 = await 본문()
  확인(글.includes("이번 정산 마감"), "정산 마감 카드가 있다")
  확인(!!처음, `마감일과 요일이 적혀 있다 (${처음})`)
  확인(/D-\d+|오늘/.test(글), "D-day 가 적혀 있다")
  확인(글.includes("매월"), "어떤 규칙으로 나온 날인지 적는다")

  // ② 기준일 바꾸기 — 10일로
  확인(await 열기(), "「고치기」가 있다")
  await 잠깐(300)
  확인(await 채우기("정산 기준일", "10"), "기준일 칸이 있다")
  확인(await 누르기("저장"), "저장 버튼이 있다")
  for (let i = 0; i < 30; i++) {
    await 잠깐(400)
    if ((await 본문()).includes("규칙을 바꿨습니다")) break
  }
  await 가기()
  const 바뀐 = await 마감일()
  확인(바뀐 !== 처음, `기준일을 바꾸니 마감일이 따라 바뀐다 (${처음} → ${바뀐})`)
  확인((바뀐 ?? "").endsWith("-10") || (await 본문()).includes("매월 10일"), `10일 규칙이 반영됐다 (${바뀐})`)

  // ③ 이 달만 따로 — 규칙을 이긴다
  const 연월 = (바뀐 ?? "2026-09-10").slice(0, 7)
  const 콕 = `${연월}-28`
  확인(await 열기(), "다시 연다")
  await 잠깐(300)
  확인(await 채우기("이번 달 마감일", 콕), "이번 달 마감일 칸이 있다")
  await 채우기("이번 달 마감 사유", "e2e")
  확인(await 누르기("이 달만 적용"), "「이 달만 적용」이 있다")
  for (let i = 0; i < 30; i++) {
    await 잠깐(400)
    if ((await 본문()).includes("마감을")) break
  }
  await 가기()
  const 콕적용 = await 마감일()
  확인(콕적용 === 콕, `그 달만 잡은 날이 규칙을 이긴다 (${콕적용})`)
  확인((await 본문()).includes("이번 달만 따로 잡음"), "규칙이 아니라 사람이 잡은 날이라고 말한다")

  // ④ 되돌리기
  확인(await 열기(), "다시 연다")
  await 잠깐(300)
  await 채우기("이번 달 마감일", "")
  확인(await 누르기("규칙대로"), "「규칙대로」가 있다")
  for (let i = 0; i < 30; i++) {
    await 잠깐(400)
    if ((await 본문()).includes("규칙대로 되돌렸습니다")) break
  }
  await 가기()
  확인((await 마감일()) === 바뀐, `규칙대로 돌아온다 (${await 마감일()})`)
} finally {
  // ⑤ 원래 규칙으로 되돌린다 — 시연 화면을 바꿔 놓고 끝내지 않는다.
  try {
    await 가기()
    await 열기()
    await 잠깐(300)
    await 채우기("정산 기준일", "25")
    await 누르기("저장")
    await 잠깐(1500)
    await 가기()
    const 끝 = await 마감일()
    확인((await 본문()).includes("매월 25일"), `원래 규칙(25일)으로 되돌렸다 (${끝})`)
  } catch {
    log("⚠ 되돌리기 실패 — ./db/psql.sh -c \"update app.settlement_rule set 기준일=25, 이동='앞' where id=1\"")
    실패 += 1
  }
  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
