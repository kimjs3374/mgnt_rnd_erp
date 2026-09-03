// 신청 단계 계상 — **선정 전에도 과제비를 잡을 수 있는가.**
//
// 사업비 계상은 신청서에 넣는 것이라 선정 전에 하는 일이다. 전에는 계상 대기열이
// 신청중을 통째로 빼고 있어서, 선정된 뒤에야 처음 계상하는 순서가 됐다(실제 일과 반대).
//
//   ① 신청중 목록에서 그 과제의 「계상」으로 바로 갈 수 있다
//   ② 계상 화면이 **협약이 아니라 신청 계획**이라고 말한다
//   ⑤ 한도 검산은 신청 단계에서도 돈다 — 제출 전에 잡아야 값어치가 있다
//
// ⚠ 예전 ③④(「과제 계상」 대기열의 「신청」 배지 · 「신청 단계만」 필터)는 뺐다 —
//   그 화면(/project-budgeting)을 없앴다(2026-09-04 사용자 지시). 총사업비를 잡는 자리도
//   같이 옮겨서 이제 계상 탭의 재원 구성 카드(FundingShareCard)에서 바로 한다 —
//   그 인라인 입력 검증은 tests/e2e-applying-budgeting.mjs 가 한다.
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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1200"],
  defaultViewport: { width: 1700, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 본문 = () => page.evaluate(() => document.body.innerText)
const 가기 = async (p) => {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(400)
}

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  // ① 신청중 목록 → 계상 진입
  await 가기("/projects/applying")
  확인((await 본문()).includes("과제비를 계상할 수 있습니다"), "신청중 화면이 계상할 수 있다고 알려 준다")
  const 계상링크 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr a")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h && h.endsWith("/budget")),
  )
  확인(계상링크.length > 0, `신청중 줄마다 계상으로 가는 길이 있다 (${계상링크.length}개)`)

  // ② 계상 화면이 협약이 아니라 신청 계획이라고 말한다
  await 가기(계상링크[0])
  const 계상본문 = await 본문()
  확인(계상본문.includes("신청 단계 계상입니다"), "계상 화면이 신청 단계임을 밝힌다")
  확인(계상본문.includes("아직 협약 금액이 아닙니다"), "협약 금액이 아니라고 못박는다")
  확인(계상본문.includes("연구비 계상") || 계상본문.includes("배정액"), "계상 표가 실제로 열린다")

  // ⑤ 한도 검산이 신청 단계에서도 도는가 — 화면에 한도/검산 말이 있어야 한다
  확인(
    /한도|검산|초과/.test(계상본문),
    "한도 검산이 신청 단계에서도 보인다(제출 전에 잡아야 값어치가 있다)",
  )

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
