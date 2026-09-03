// 사업비 증빙이 빈 곳을 **대장에서 바로 보고 바로 갈 수 있는가.** (2026-09-04 사용자 지시)
//
//   ① 전체 탭 오른쪽 카드가 「사업비 증빙 미비」다 (예전 「단계별」은 위 칩과 같은 숫자라 뺐다)
//   ② 카드 숫자와 표에 붙은 배지 개수가 맞는다
//   ③ 배지를 누르면 **그 과제의 집행 탭**으로 간다 — 증빙 파일이 실제로 붙는 자리
//   ④ 증빙이 다 찬 과제에는 배지가 안 붙는다
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

  const 글 = await page.evaluate(() => document.body.innerText)

  // ① 카드
  확인(글.includes("사업비 증빙 미비"), "오른쪽 카드가 「사업비 증빙 미비」다")
  확인(!글.includes("신청중 · 수행중 · 사업종료"), "예전 「단계별」 카드는 없어졌다(칩과 겹쳤다)")

  // ② 카드 숫자 = 배지 개수
  const 배지 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody a")]
      .filter((a) => a.textContent.trim().startsWith("증빙"))
      .map((a) => ({ 글: a.textContent.trim(), href: a.getAttribute("href") ?? "" })),
  )
  log(`배지 ${배지.length}개: ${배지.map((b) => b.글).join(" · ")}`)

  // 카드 값은 「과제 수」다. 카드 바로 아래 sub 에 집행·칸 수가 있다.
  const 카드수 = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.textContent.trim().startsWith("사업비 증빙 미비") && d.children.length <= 4,
    )
    const m = el?.innerText.match(/(\d+)/)
    return m ? Number(m[1]) : null
  })
  확인(카드수 === 배지.length, `카드 숫자와 배지 개수가 같다 (카드 ${카드수} · 배지 ${배지.length})`)
  확인(배지.length > 0, "증빙이 빈 과제가 실제로 잡힌다")

  // ③ 바로 가기 — 그 과제의 집행 탭
  확인(
    // 정확한 딥링크(`?expense=<id>`)는 tests/e2e-evidence-deeplink.mjs 가 본다.
    // 여기서는 **집행 화면으로 간다**까지만 — 두 테스트가 같은 것을 두 번 박으면 같이 썩는다.
    배지.every((b) => /^\/projects\/\d+\/expenses(\?|$)/.test(b.href)),
    `배지가 그 과제의 집행 화면으로 간다 (${배지[0]?.href})`,
  )
  const 첫 = 배지[0]
  await page.goto(`${BASE}${첫.href}`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 600))
  const 집행글 = await page.evaluate(() => document.body.innerText)
  확인(
    집행글.includes("집행") && !집행글.includes("아직 집행할 것이 없습니다"),
    "눌러서 간 자리가 실제로 집행 화면이다",
  )

  // ④ 다 찬 과제에는 안 붙는다 — 배지 없는 줄이 하나라도 있어야 「무조건 붙는 것」이 아님이 확인된다
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 600))
  const 줄수 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  확인(배지.length < 줄수, `배지가 모든 줄에 붙지는 않는다 (${배지.length}/${줄수}줄)`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
