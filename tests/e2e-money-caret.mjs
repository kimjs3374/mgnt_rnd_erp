// 금액칸에서 **가운데 자리를 고칠 수 있는가.**
//
// 사용자 지적(2026-09-04): 「2,000,000 을 2,300,000 으로 바꾸려고 중간에 3 만 넣으면 되게.
// 지금은 1의 자리부터 다시 써야 한다.」
// 원인은 포맷을 다시 할 때마다 **커서가 끝으로 튀는** 것이었다.
//
// ⚠ 이건 **진짜 키보드로 쳐야** 확인된다. 값을 프로그램으로 넣으면 커서가 안 움직여서
//   고치기 전 코드로도 통과한다(그래서 예전 e2e 가 이 버그를 못 잡았다).
//   `page.keyboard.type()` 과 `el.setSelectionRange()` 로 사람이 하는 것과 같게 만든다.
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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

await 로그인하고(page, BASE)

/** 금액칸 하나를 잡는다 — 연구원 등록 폼의 「연봉」이 제일 조용한 자리다(과제 데이터를 안 건드린다). */
const 칸 = () => page.$('input[aria-label="연봉"]')

const 읽기 = () =>
  page.evaluate(() => {
    const el = document.querySelector('input[aria-label="연봉"]')
    return { 값: el?.value ?? "", 커서: el?.selectionStart ?? -1 }
  })

/** 값을 넣고 커서를 원하는 자리에 둔다. */
async function 놓기(값, 커서) {
  await page.evaluate(
    ({ 값, 커서 }) => {
      const el = document.querySelector('input[aria-label="연봉"]')
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      s.call(el, 값)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.focus()
      el.setSelectionRange(커서, 커서)
    },
    { 값, 커서 },
  )
  await new Promise((r) => setTimeout(r, 250))
}

try {
  await page.goto(`${BASE}/researchers`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 500))
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.trim().startsWith("+ 연구원 등록"),
    )
    b?.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  확인(!!(await 칸()), "금액칸을 찾았다")

  // ① 사용자가 말한 그 장면 — 2,000,000 가운데에 3 을 넣어 2,300,000 으로
  await 놓기("2000000", 0)
  let s = await 읽기()
  확인(s.값 === "2,000,000", `콤마가 붙는다 (${s.값})`)

  // 「2,」 뒤(자리 2)에 커서를 놓고 3 을 친다 → 2,3|00,000
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="연봉"]')
    el.focus()
    el.setSelectionRange(2, 2)
  })
  await page.keyboard.type("3")
  await new Promise((r) => setTimeout(r, 250))
  s = await 읽기()
  확인(s.값 === "23,000,000", `가운데에 3 을 넣으면 23,000,000 (${s.값})`)
  // ⚠ **자리(index)로 재면 안 된다.** 콤마 개수가 포맷마다 달라져서 같은 뜻이 다른 숫자가 된다
  //   (`23,000,000` 에서 「3 바로 뒤」는 자리 2 다 — 처음에 4 로 잘못 적었다).
  //   사람이 아는 뜻은 **「커서 앞에 숫자가 몇 개인가」** 다. 2,000,000 가운데에 3 을 넣었으니 2 개.
  const 커서앞숫자 = await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="연봉"]')
    return el.value.slice(0, el.selectionStart).replace(/[^\d]/g, "").length
  })
  확인(
    커서앞숫자 === 2,
    `커서가 방금 친 3 바로 뒤에 있다 (앞 숫자 ${커서앞숫자}개 — 끝으로 튀었으면 9)`,
  )

  // ② 이어서 한 자리 더 — 커서가 제자리에 있으니 그냥 이어 칠 수 있다
  await page.keyboard.type("4")
  await new Promise((r) => setTimeout(r, 250))
  s = await 읽기()
  확인(s.값 === "234,000,000", `이어서 4 를 치면 234,000,000 (${s.값})`)

  // ③ Backspace — 방금 친 4 가 지워져야 한다
  await page.keyboard.press("Backspace")
  await new Promise((r) => setTimeout(r, 250))
  s = await 읽기()
  확인(s.값 === "23,000,000", `Backspace 로 방금 친 것이 지워진다 (${s.값})`)

  // ④ 콤마 위에서 Backspace — 아무 일도 안 일어나면 「키가 안 먹는다」로 보인다.
  //    콤마 바로 뒤(자리 3)에 커서를 두고 지우면 그 앞 숫자(3)가 지워져야 한다.
  await 놓기("23000000", 0)
  s = await 읽기()
  확인(s.값 === "23,000,000", `되돌려 놓았다 (${s.값})`)
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="연봉"]')
    el.focus()
    el.setSelectionRange(3, 3) // "23," 바로 뒤
  })
  await page.keyboard.press("Backspace")
  await new Promise((r) => setTimeout(r, 250))
  s = await 읽기()
  확인(s.값 === "2,000,000", `콤마 위에서 지우면 그 앞 숫자가 지워진다 (${s.값})`)

  // ⑤ 맨 뒤에서 치는 기존 동작도 그대로여야 한다
  await 놓기("2000000", 9)
  await page.keyboard.type("0")
  await new Promise((r) => setTimeout(r, 250))
  s = await 읽기()
  확인(s.값 === "20,000,000", `맨 뒤에 0 을 붙이면 20,000,000 (${s.값})`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
  log("· 저장하지 않고 끝낸다 — 아무 데이터도 안 바꾼다")
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
