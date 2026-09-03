// 공고 → 지원 등록 → 선정 → 대장 연동. 실제로 눌러서 확인한다.
//
// ⚠ 시드 과제 12건을 건드리지 않는다. 테스트가 만든 행은 끝에서 지운다 —
//   과제 수가 늘면 대시보드 카드와 데모 대본의 숫자가 어긋난다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 공고 = Number(process.argv[2] ?? 0)
if (!공고) {
  console.error("공고 id 를 인자로 줄 것: node tests/e2e-apply.mjs <공고_id>")
  process.exit(1)
}
const log = (...a) => console.log("  ", ...a)

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
const 본문 = () => page.evaluate(() => document.body.innerText)
const 눌러 = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l)
    b?.click()
    return !!b
  }, label)

try {
  await page.goto(`${BASE}/announcements/${공고}`, { waitUntil: "networkidle0", timeout: 60000 })
  let t = await 본문()
  log(`${t.includes("지원 · 선정 · 대장") ? "✓" : "✗"} 패널이 공고 상세에 붙었다`)
  log(`${t.includes("이 공고에 지원 등록") ? "✓" : "✗"} 지원 등록 폼(이 공고엔 아직 지원이 없다)`)

  const 과제명 = `E2E 지원테스트 ${Date.now().toString().slice(-6)}`
  await page.evaluate((v) => {
    const set = (el, val) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      s.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const 칸 = [...document.querySelectorAll("input")]
    const 이름 = 칸.find((i) => i.type === "text" && !i.getAttribute("aria-label"))
    if (이름) set(이름, v)
    const 금액 = 칸.find((i) => i.getAttribute("aria-label") === "신청 지원금액")
    if (금액) set(금액, "50000000")
  }, 과제명)
  await new Promise((r) => setTimeout(r, 200))
  const 금액표시 = await page.evaluate(
    () =>
      [...document.querySelectorAll("input")].find(
        (i) => i.getAttribute("aria-label") === "신청 지원금액",
      )?.value ?? "",
  )
  log(`${금액표시 === "50,000,000" ? "✓" : "✗"} 금액칸 콤마 (${금액표시})`)

  log(`${(await 눌러("이 공고에 지원 등록")) ? "· 등록 클릭" : "✗ 버튼 없음"}`)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    t = await 본문()
    if (t.includes("지원사업 대장에 한 줄이 생겼습니다")) break
  }
  log(`${t.includes("한 줄이 생겼습니다") ? "✓" : "✗"} 등록됨`)
  log(`${t.includes("접수") ? "✓" : "✗"} 선정결과 「접수」로 시작`)

  // 대장에 실제로 떴는가
  await page.goto(`${BASE}/programs`, { waitUntil: "networkidle0", timeout: 60000 })
  t = await 본문()
  log(`${t.includes(과제명) ? "✓" : "✗"} 지원사업 대장에 뜬다`)

  // 과제사업 대장에는 아직 안 떠야 정상인가? — 같은 테이블이라 뜬다. 상태로 구분한다.
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0", timeout: 60000 })
  t = await 본문()
  log(`과제사업 대장 표시: ${t.includes(과제명) ? "뜬다(상태=신청)" : "안 뜬다"}`)

  // 선정 처리
  await page.goto(`${BASE}/announcements/${공고}`, { waitUntil: "networkidle0", timeout: 60000 })
  log(`${(await 눌러("발표·심사")) ? "· 발표·심사 클릭" : "✗"}`)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    t = await 본문()
    if (t.includes("발표심사(으)로 기록했습니다")) break
  }
  log(`${t.includes("기록했습니다") ? "✓" : "✗"} 발표·심사 기록`)

  await page.goto(`${BASE}/announcements/${공고}`, { waitUntil: "networkidle0", timeout: 60000 })
  log(`${(await 눌러("선정")) ? "· 선정 클릭" : "✗"}`)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    t = await 본문()
    if (t.includes("과제사업 대장에 뜨고")) break
  }
  log(`${t.includes("과제사업 대장에 뜨고") ? "✓" : "✗"} 선정 기록 + 다음 할 일 안내`)
  log(`${t.includes("상태 수행중") ? "✓" : "✗"} 상태가 수행중으로 바뀐다`)
  log(`${t.includes("연구비 계상 시작") ? "✓" : "✗"} 계상으로 가는 링크가 생긴다`)

  console.log(`\n  정리용: ./db/psql.sh -c "delete from app.projects where 과제명='${과제명}'"`)
  log(errors.length ? `⚠ 콘솔 오류 ${errors.length}건: ${errors.slice(0, 2).join(" | ")}` : "✓ 콘솔 오류 없음")
} finally {
  await browser.close()
}
