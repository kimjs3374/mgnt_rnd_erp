// 달력을 펼친 상태와 접은 상태를 눈으로 확인한다. 클릭이 필요해 정적 스크린샷으로는 안 된다.
import puppeteer from "puppeteer-core"

const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1500, height: 1000 },
})
const p = await b.newPage()
const errs = []
p.on("pageerror", (e) => errs.push(String(e)))

const 클릭 = (글자) =>
  p.evaluate(
    (t) => [...document.querySelectorAll("button,a")].find((x) => x.textContent.trim() === t)?.click(),
    글자,
  )

try {
  await p.goto("http://127.0.0.1:3610/dashboard", { waitUntil: "networkidle0", timeout: 60000 })

  await 클릭("달력 펼치기")
  await new Promise((r) => setTimeout(r, 500))
  await p.screenshot({ path: process.env.HOME + "/work/cal-open.png" })

  const 셀 = await p.$$eval("button[aria-pressed]", (bs) => bs.length)
  const 접기있나 = await p.evaluate(() =>
    [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === "달력 접기"),
  )
  console.log("펼친 뒤 날짜칸:", 셀, "(7의 배수여야 정상)")
  console.log("접기 버튼:", 접기있나 ? "있음" : "⚠ 없음")

  // 이벤트가 있는 달로 이동 — 12월(D-119 사업종료)
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() =>
      document.querySelector('button[aria-label="다음 달"]')?.click(),
    )
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 400))
  await p.screenshot({ path: process.env.HOME + "/work/cal-dec.png" })
  const 월 = await p.evaluate(
    () => document.body.innerText.match(/\d{4}년 \d+월/)?.[0] ?? "?",
  )
  console.log("이동한 달:", 월)

  await 클릭("달력 접기")
  await new Promise((r) => setTimeout(r, 400))
  const 접힘 = await p.evaluate(() =>
    [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === "달력 펼치기"),
  )
  console.log("접기 동작:", 접힘 ? "됨" : "⚠ 안 됨")
  await p.screenshot({ path: process.env.HOME + "/work/cal-closed.png" })

  console.log("콘솔 오류:", errs.length ? errs.slice(0, 2) : "없음")
} catch (e) {
  console.error("실패:", e.message)
  await p.screenshot({ path: process.env.HOME + "/work/cal-err.png" })
  process.exitCode = 1
} finally {
  await b.close()
}
