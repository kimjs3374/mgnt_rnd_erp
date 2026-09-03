// 집행 상세 모달 + 정정 사유 입력 — 실제 클릭 검증
// 화면이 렌더된다고 동작하는 게 아니다. 눌러봐야 안다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const shot = (p, n) => p.screenshot({ path: `/tmp/shots/e2e-${n}.png` })
const log = (...a) => console.log("  ", ...a)

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  // ── 1. 목록 ────────────────────────────────────────────────
  await page.goto(`${BASE}/expenses`, { waitUntil: "networkidle0", timeout: 30000 })
  await shot(page, "1-list")
  const rowCount = await page.$$eval("tbody tr", (r) => r.length)
  log(`목록 ${rowCount}행`)

  // ── 2. 검토대기 행을 찾아 클릭 ──────────────────────────────
  const target = await page.evaluateHandle(() => {
    const rows = [...document.querySelectorAll("tbody tr")]
    return rows.find((r) => r.textContent.includes("검토대기")) ?? rows[0]
  })
  const label = await page.evaluate((el) => el.textContent.slice(0, 60), target)
  log(`클릭 대상: ${label}`)
  await target.asElement().click()
  await new Promise((r) => setTimeout(r, 700))
  await shot(page, "2-detail")

  const detailText = await page.evaluate(
    () => document.querySelector('[data-slot="dialog-content"]')?.textContent ?? "",
  )
  if (!detailText) throw new Error("모달이 열리지 않았다")
  log(`모달 열림 · ${detailText.length}자`)
  for (const k of ["AI 제안", "우리 회사 과거 처리", "이대로 확정", "비목 수정"]) {
    log(`  ${detailText.includes(k) ? "✓" : "✗"} ${k}`)
  }

  // ── 3. 확신도 70% 미만이면 [이대로 확정] 이 잠겨야 한다 ──────
  const confirmDisabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-slot="dialog-content"] button')].find(
      (x) => x.textContent.trim() === "이대로 확정",
    )
    return b ? b.disabled : null
  })
  log(`[이대로 확정] disabled = ${confirmDisabled}  ← 확신도 70% 미만이면 true 여야 정상`)

  // ── 4. [비목 수정] ──────────────────────────────────────────
  await page.evaluate(() => {
    ;[...document.querySelectorAll('[data-slot="dialog-content"] button')]
      .find((x) => x.textContent.trim() === "비목 수정")
      ?.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  await shot(page, "3-correct-form")

  // ── 5. 사유 없이 제출 시도 → 막혀야 한다 ────────────────────
  const blockedEmpty = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-slot="dialog-content"] button')].find(
      (x) => x.textContent.trim() === "정정 확정",
    )
    return b ? b.disabled : null
  })
  log(`사유 없이 [정정 확정] disabled = ${blockedEmpty}  ← true 여야 정상`)

  // ── 6. 비목 바꾸고 사유 채우기 ──────────────────────────────
  const selects = await page.$$('[data-slot="dialog-content"] select')
  await selects[0].select("ACTIVITY")
  await new Promise((r) => setTimeout(r, 200))
  await selects[1].select("LAB_OPERATION")

  await page.evaluate(() => {
    const r = [...document.querySelectorAll('input[name="정정사유유형"]')].find(
      (x) => x.value === "관행",
    )
    r?.click()
  })
  await page.type(
    '[data-slot="dialog-content"] input[type="text"]',
    "연구원 지급 노트북은 사무 겸용이라 운영비로 처리해 왔음",
  )
  await new Promise((r) => setTimeout(r, 300))
  await shot(page, "4-filled")

  const canSubmit = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-slot="dialog-content"] button')].find(
      (x) => x.textContent.trim() === "정정 확정",
    )
    return b ? !b.disabled : null
  })
  log(`사유 채운 뒤 제출 가능 = ${canSubmit}  ← true 여야 정상`)

  // ── 7. 제출 ────────────────────────────────────────────────
  await page.evaluate(() => {
    ;[...document.querySelectorAll('[data-slot="dialog-content"] button')]
      .find((x) => x.textContent.trim() === "정정 확정")
      ?.click()
  })
  await new Promise((r) => setTimeout(r, 2500))
  await shot(page, "5-after")

  const stillOpen = await page.evaluate(
    () => !!document.querySelector('[data-slot="dialog-content"]'),
  )
  log(`제출 후 모달 닫힘 = ${!stillOpen}`)

  const listAfter = await page.evaluate(() => document.body.textContent)
  log(`목록에 「연구실 운영비」 반영 = ${listAfter.includes("연구실 운영비")}`)

  console.log("\n  콘솔 오류:", errors.length ? errors.slice(0, 5) : "없음")
} catch (e) {
  console.error("  실패:", e.message)
  await shot(page, "error")
  process.exitCode = 1
} finally {
  await browser.close()
}
