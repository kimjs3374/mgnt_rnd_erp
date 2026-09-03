import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"
// 종료된 과제에는 「연구비 계상」 진입점을 두지 않는다 — 2026-09-03 사용자 지시.
//
// 계상은 협약·수행 중에 하는 일이다. 끝난 과제에 계상이 열려 있으면 아직 배정을 고칠 수
// 있다는 뜻으로 읽히고, 실제로 고치면 정산 대조 기준이 바뀐다.
// 탭을 뺀 것이 **데이터를 숨긴 것이 아님**도 같이 본다 — 정산 탭의 원장은 그대로 있어야 한다.
//
// 서버 렌더 결과만 보므로 브라우저를 띄우지 않는다(fetch 로 끝난다).
//   node tests/e2e-closed-project-budget.mjs

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const 종료과제 = 13 // RS-2022-00284460 · 상태=종료
const 수행중과제 = 2 // P01 = RS-2025-00410021 · 시연 주인공. 읽기만 한다.

let 실패 = 0
const ok = (조건, 무엇, 덧말 = "") => {
  console.log(`  ${조건 ? "ok  " : "FAIL"} ${무엇}${덧말 ? ` — ${덧말}` : ""}`)
  if (!조건) 실패++
}

// ⚠ 게이트가 붙은 뒤(2026-09-04)로는 **fetch 로 화면을 못 읽는다** — 307 로 /login 으로 튕긴다.
// 읽기만 하는 테스트라 브라우저로 바꿔도 검사 내용은 그대로다.
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1200 },
})
const page = await browser.newPage()
await 로그인하고(page, BASE)

const get = async (path) => {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 60000 })
  if (!res || !res.ok()) throw new Error(`${path} → HTTP ${res?.status()}`)
  return page.content()
}

/** 탭 줄에 그 탭이 걸려 있는가. 본문의 다른 글자와 섞이지 않게 href 로 본다. */
const 탭있나 = (html, id, seg) =>
  new RegExp(`href="/projects/${id}${seg ? `/${seg}` : ""}"`).test(html)

console.log("① 종료 과제 상세(개요) — 계상으로 가는 길이 없다")
{
  const html = await get(`/projects/${종료과제}`)
  // 탭만 보지 않는다. 개요 본문에도 「연구비 계상에서 고치기 →」 링크가 있었다 —
  // 탭만 빼고 그 링크를 남기면 결국 같은 화면으로 들어간다. 진입점 전체를 본다.
  ok(!탭있나(html, 종료과제, "budget"), "계상 탭·개요 링크가 모두 없다")
  ok(탭있나(html, 종료과제, "expenses"), "「집행」 탭은 그대로 있다")
  ok(탭있나(html, 종료과제, "settlement"), "「정산」 탭은 그대로 있다")
  ok(html.includes("종료"), "머리말에 상태 배지(종료)가 보인다")
}

console.log("② 수행중 과제 상세 — 계상 탭이 그대로 있다 (거르기가 과하지 않은가)")
{
  const html = await get(`/projects/${수행중과제}`)
  ok(탭있나(html, 수행중과제, "budget"), "「연구비 계상」 탭이 있다")
  ok(탭있나(html, 수행중과제, "settlement"), "「정산」 탭이 있다")
}

console.log("③ 과제사업 대장 — 종료 줄에는 「계상」 링크를 걸지 않는다")
{
  // ⚠ 단계가 화면으로 갈렸다(2026-09-04) — 종료 과제는 `/projects`(수행중)에 없고
  //   `/projects/closed` 에 모여 있다. 예전 주소로 재면 「줄이 없어서 통과」가 되어
  //   검사가 아무것도 안 보게 된다.
  const html = await get("/projects/closed")
  ok(
    !html.includes(`href="/projects/${종료과제}/budget"`),
    `종료 과제(${종료과제}) 줄에 계상 링크가 없다`,
  )
  ok(
    html.includes(`href="/projects/${종료과제}/settlement"`),
    "그 줄의 정산 링크는 남아 있다",
  )
}

// 수행중 줄은 수행중 화면에서 본다 — 단계가 화면으로 갈렸다(2026-09-04).
{
  const html = await get("/projects")
  ok(
    html.includes(`href="/projects/${수행중과제}/budget"`),
    `수행중 과제(${수행중과제}) 줄에는 계상 링크가 있다`,
  )
  ok(
    !html.includes(`href="/projects/${종료과제}/`),
    "수행중 화면에는 종료 과제 줄이 아예 없다",
  )
}

console.log("④ 주소로 직접 들어오면 — 화면을 없애지 않고 왜 빠졌는지 말한다")
{
  const html = await get(`/projects/${종료과제}/budget`)
  ok(html.includes("종료된 과제입니다"), "안내가 보인다")
  ok(html.includes("정산 탭"), "지난 계상을 어디서 보는지 알려 준다")
  ok(!탭있나(html, 종료과제, "budget"), "이 화면에서도 계상 탭은 안 보인다")
  ok(html.includes("계상 저장"), "계상 표 자체는 열려 있다(북마크로 들어온 경우)")
}

console.log("⑤ 데이터를 숨긴 게 아니다 — 종료 과제 정산 원장은 그대로다")
{
  const html = await get(`/projects/${종료과제}/settlement`)
  ok(html.includes("과제비 원장"), "정산 원장이 뜬다")
  ok(/[0-9],[0-9]{3}/.test(html), "배정·집행 금액이 찍힌다")
}

await browser.close()

console.log()
if (실패) {
  console.log(`✗ 실패 ${실패}건`)
  process.exit(1)
}
console.log("✓ 전 항목 통과")
