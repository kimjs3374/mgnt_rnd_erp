import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const log = (...a) => console.log("  ", ...a)

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
})

try {
  // ── 1. 자동 로그인 체크 안 하고 로그인 → 세션 쿠키(브라우저 종료 시 삭제)인지 ──
  const p1 = await browser.newPage()
  await p1.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 30000 })
  await p1.type("#username", "magnatech")
  await p1.type("#password", "magna12!@")
  await Promise.all([
    p1.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    p1.click('button[type="submit"]'),
  ])
  let cookies = await p1.cookies()
  let sess = cookies.find((c) => c.name === "rnd_session")
  log("[미체크] 세션쿠키 expires:", sess?.expires, "(-1 이면 세션쿠키=정상)")
  await p1.evaluate(() => document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim()
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
  }))
  await p1.close()

  // ── 2. 자동 로그인 체크하고 로그인 → 만료일이 미래로 멀리 찍히는지 ──
  const p2 = await browser.newPage()
  await p2.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 30000 })
  await p2.type("#username", "magnatech")
  await p2.type("#password", "magna12!@")
  await p2.click('input[name="remember"]')
  await Promise.all([
    p2.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    p2.click('button[type="submit"]'),
  ])
  cookies = await p2.cookies()
  sess = cookies.find((c) => c.name === "rnd_session")
  const daysLeft = sess ? (sess.expires * 1000 - Date.now()) / (1000 * 60 * 60 * 24) : null
  log("[체크] 세션쿠키 만료까지 남은 일수:", daysLeft?.toFixed(1), "(약 30이면 정상)")
  await p2.close()

  // ── 3. 아이디 저장 — 체크 후 로그인, 새 탭에서 /login 열면 아이디가 채워져 있는지 ──
  const p3 = await browser.newPage()
  await p3.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 30000 })
  await p3.type("#username", "magnatech")
  await p3.type("#password", "magna12!@")
  await p3.click('input[name="rememberId"]')
  await Promise.all([
    p3.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    p3.click('button[type="submit"]'),
  ])
  // 로그아웃해서 다시 /login을 볼 수 있게
  await p3.evaluate(() => {
    const form = [...document.querySelectorAll("form")].find((f) => f.textContent.includes("로그아웃"))
  })
  await p3.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 30000 })
  const prefilled = await p3.$eval("#username", (el) => el.value)
  log("[아이디저장] 재방문 시 아이디 필드 값:", prefilled)
  await p3.close()

  log("DONE")
} catch (e) {
  log("FAIL:", e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
