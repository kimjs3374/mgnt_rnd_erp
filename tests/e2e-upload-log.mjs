// 서류 올린 기록 — 누가(아이디) 언제 올렸나. (2026-09-04 사용자 지시)
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
  console.log("① 메뉴에서 갈 수 있다")
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 })
  const 메뉴 = await page.evaluate(() =>
    [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/uploads"),
  )
  확인(메뉴, "사이드바에 「서류 올린 기록」 링크가 있다")

  await page.goto(`${BASE}/uploads`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  const 글 = await page.evaluate(() => document.body.innerText)

  console.log("② 다섯 자리를 합쳐 보여 준다")
  const 줄 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.innerText.trim()),
    ),
  )
  확인(줄.length > 0, `기록이 있다 (${줄.length}줄)`)
  const 구분들 = new Set(줄.map((c) => c[2]))
  확인(구분들.size >= 2, `여러 자리에서 모은다 (${[...구분들].join(" · ")})`)

  console.log("③ 누가 · 언제")
  확인(
    줄.every((c) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(c[0]) || c[0] === "—"),
    `올린 때가 날짜+시각이다 (${줄[0]?.[0]})`,
  )
  const 아이디칸 = 줄.map((c) => c[1])
  확인(아이디칸.every((v) => v.length > 0), "올린 사람 칸이 비어 있지 않다")
  확인(
    아이디칸.some((v) => v === "확인 안 됨"),
    "로그인 전 기록은 **아이디를 지어내지 않고** 「확인 안 됨」이라고 말한다",
  )
  // 실제 로그인 아이디로 올린 기록이 하나라도 있으면 그 아이디가 보여야 한다.
  const 진짜아이디 = 아이디칸.filter((v) => v !== "확인 안 됨")
  확인(
    진짜아이디.length > 0,
    `로그인 아이디로 남은 기록이 있다 (${[...new Set(진짜아이디)].join(" · ") || "없음"})`,
  )
  확인(
    진짜아이디.every((v) => !v.includes("관리자")),
    "표시명이 아니라 **아이디**를 적는다 — 이름을 바꿔도 기록이 딴사람이 되지 않는다",
  )

  console.log("④ 최근 것부터")
  const 때 = 줄.map((c) => c[0]).filter((v) => v !== "—")
  확인(
    때.every((v, i) => i === 0 || 때[i - 1] >= v),
    `최근 것이 위다 (${때[0]} → ${때[때.length - 1]})`,
  )

  console.log("⑤ 걸러 볼 수 있다")
  const 구분값 = [...구분들][0]
  await page.select('select[aria-label="구분"]', 구분값)
  await 잠깐(400)
  const 걸린뒤 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map((r) => r.querySelectorAll("td")[2].innerText.trim()),
  )
  확인(
    걸린뒤.length > 0 && 걸린뒤.every((v) => v === 구분값),
    `구분으로 거른다 — ${구분값} ${걸린뒤.length}건`,
  )
  // ⚠ 구분을 먼저 되돌린다. 안 그러면 앞 필터가 걸린 채라 0건이 나와
  //    every() 가 **빈 배열에서 참**이 되어 검사가 아무것도 안 본다.
  await page.select('select[aria-label="구분"]', "전체")
  await 잠깐(300)
  await page.select('select[aria-label="올린 사람"]', "확인 안 됨")
  await 잠깐(400)
  const 모름만 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map((r) => r.querySelectorAll("td")[1].innerText.trim()),
  )
  확인(
    모름만.length > 0 && 모름만.every((v) => v === "확인 안 됨"),
    `「누가 올렸는지 모르는 것만」 볼 수 있다 (${모름만.length}건)`,
  )

  console.log("⑥ 보는 화면이다")
  확인(!글.includes("지우기") && !글.includes("삭제"), "여기서 지우지 않는다 — 기록이 조작 창을 겸하지 않는다")

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors[0].slice(0, 90)}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
