// 업체 화면 — 「등록/미등록」 말 · 표에서 금액 삭제 · 구매내역 창. (2026-09-04 사용자 지시)
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
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await page.goto(`${BASE}/vendors`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)

  console.log("① 「등록 / 미등록」으로 부른다")
  const 화면 = await page.evaluate(() => document.body.innerText)
  확인(!화면.includes("미확보"), "「미확보」라는 말이 화면에 없다")
  확인(!/확보\s*\d/.test(화면), "「확보 1」 같은 단위 없는 숫자가 없다")
  확인(화면.includes("미등록") || 화면.includes("등록"), "「등록 / 미등록」으로 말한다")

  console.log("② 표의 구매내역 칸에 금액이 없다")
  const 표 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")]
    return rows.map((r) => {
      const c = [...r.querySelectorAll("td")]
      return { 업체: c[0]?.innerText.trim() ?? "", 끝칸: c[c.length - 1]?.innerText.trim() ?? "" }
    })
  })
  확인(표.length > 0, `업체가 있다 (${표.length}곳)`)
  확인(
    표.every((r) => !r.끝칸.includes("₩")),
    `마지막 칸에 금액이 없다 (예: ${표[0]?.끝칸})`,
  )
  const 버튼줄 = 표.filter((r) => r.끝칸.startsWith("구매내역"))
  확인(버튼줄.length > 0, `「구매내역 N건」 버튼이 있다 (${버튼줄.length}곳)`)
  확인(
    표.some((r) => r.끝칸 === "거래 없음"),
    "거래가 없는 업체는 「거래 없음」이라고 말한다",
  )

  console.log("③ 누르면 구매내역 창이 뜬다 (수정 창이 아니라)")
  const 누름 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("tbody button")].find((x) =>
      x.innerText.trim().startsWith("구매내역"),
    )
    b?.click()
    return b?.closest("tr")?.querySelector("td")?.innerText.trim() ?? ""
  })
  await 잠깐(600)
  const 창 = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]')
    if (!d) return null
    return {
      글: d.innerText,
      줄수: d.querySelectorAll("tbody tr").length,
      링크: [...d.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
      폼: !!d.querySelector("form"),
    }
  })
  확인(!!창, "창이 떴다")
  확인(창?.글.includes(누름), `그 업체의 창이다 — ${누름}`)
  확인(창?.글.includes("구매내역"), "제목이 구매내역이다")
  확인(!창?.폼, "**수정 폼이 아니다** — 보러 온 사람을 편집 화면에 떨어뜨리지 않는다")

  console.log("④ 창 안에 그 업체와의 거래가 있다")
  확인(창?.줄수 > 0, `거래 줄이 있다 (${창?.줄수}건)`)
  확인(창?.글.includes("₩"), "금액은 창 안에 있다 — 표에서 뺐지 헛되게 지운 게 아니다")
  확인(/\d+건 합계/.test(창?.글 ?? ""), "합계를 적는다")
  const 딥링크 = (창?.링크 ?? []).filter((h) => /\/projects\/\d+\/expenses\?expense=\d+$/.test(h))
  확인(딥링크.length > 0, `줄이 그 집행 건으로 간다 (${딥링크[0] ?? "없음"})`)

  console.log("⑤ 그 주소가 실제로 열린다")
  if (딥링크.length) {
    await page.goto(`${BASE}${딥링크[0]}`, { waitUntil: "networkidle0", timeout: 60000 })
    await 잠깐(600)
    const 상세 = await page.evaluate(() => document.body.innerText)
    확인(상세.includes("증빙"), "집행 건 상세가 열린다")
  }

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors[0].slice(0, 90)}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
