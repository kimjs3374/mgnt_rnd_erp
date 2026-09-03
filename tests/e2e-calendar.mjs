import puppeteer from "puppeteer-core"

const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1500, height: 1000 },
})
const p = await b.newPage()
await p.setCacheEnabled(false)
const errs = []
p.on("pageerror", (e) => errs.push(String(e)))

const 누르기 = (t) =>
  p.evaluate(
    (t) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t))?.click(),
    t,
  )
const 잠깐 = (ms = 500) => new Promise((r) => setTimeout(r, ms))
const H = process.env.HOME + "/work/"

try {
  await p.goto("http://127.0.0.1:3610/dashboard", { waitUntil: "networkidle0", timeout: 60000 })

  const 범례남았나 = await p.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.trim() === "일정")
    return h?.parentElement?.innerText.replace(/\s+/g, " ") ?? "?"
  })
  console.log("접힘 머리 :", 범례남았나)
  await p.screenshot({ path: H + "v0-closed.png" })

  await 누르기("달력 펼치기")
  await 잠깐(700)
  const 머리 = await p.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.trim() === "일정")
    return h?.parentElement?.innerText.replace(/\s+/g, " ") ?? "?"
  })
  console.log("펼침 머리 :", 머리)
  await p.screenshot({ path: H + "v1-month.png" })

  const 격자 = await p.evaluate(() => {
    const cell = document.querySelector('button[aria-current="date"]') || document.querySelector("button[aria-pressed]")
    const g = cell?.parentElement
    const cs = g ? getComputedStyle(g) : null
    return { display: cs?.display, cols: cs?.gridTemplateColumns?.split(" ").length, 칸: g?.children.length }
  })
  console.log("월간 격자 :", JSON.stringify(격자))

  await 누르기("주간")
  await 잠깐(500)
  await p.screenshot({ path: H + "v2-week.png" })
  console.log("주간 전환 :", await p.evaluate(() => document.body.innerText.includes("~") ? "ok" : "?"))

  await 누르기("일간")
  await 잠깐(500)
  await p.screenshot({ path: H + "v3-day.png" })
  console.log("일간 전환 :", await p.evaluate(() => /\d+월 \d+일/.test(document.body.innerText) ? "ok" : "?"))

  await 누르기("월간")
  await 잠깐(400)
  await 누르기("달력 접기")
  await 잠깐(500)
  const 접힘 = await p.evaluate(() =>
    [...document.querySelectorAll("button")].some((x) => x.textContent.trim().startsWith("달력 펼치기")),
  )
  console.log("접기     :", 접힘 ? "됨" : "⚠ 안 됨")
  console.log("콘솔오류 :", errs.length ? errs.slice(0, 2) : "없음")
} catch (e) {
  console.error("실패:", e.message)
  await p.screenshot({ path: H + "v-err.png" })
  process.exitCode = 1
} finally {
  await b.close()
}
