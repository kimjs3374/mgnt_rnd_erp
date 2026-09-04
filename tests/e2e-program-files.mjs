// 지원사업 > **서류함** — 사업별로 묶여 보이는가, 기간으로 걸러지는가, 한 번에 받아지는가.
// (2026-09-04 사용자 지시: "각 지원사업에 넣은 폴더를 한눈에 … 한번에 모아서 다운 및
//  특정 기간을 지정해 볼 수 있으면 좋겠어")
//
// ⚠ 라벨이 아니라 **역할**로 본다. 버튼 이름을 바꿀 때마다 테스트가 깨지고, 정규식이
//   조용히 -1 을 돌려주면 아무것도 확인하지 않은 채 통과한다(그 일이 세 번 있었다).
// ⚠ 시드에 기대지 않는다. 서류가 없으면 「빈 상태 안내가 뜨는가」까지만 보고 건너뛴다 —
//   더미를 넣지 않는다(사용자 지시).
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말, 곁 = "") => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}${곁 ? ` — ${곁}` : ""}`)
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1200"],
  defaultViewport: { width: 1700, height: 1200 },
})
const page = await browser.newPage()
await 로그인하고(page, BASE)
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 본문 = () => page.evaluate(() => document.body.innerText)
/** 목록에 그려진 파일 줄 수. `<li>` 안의 내려받기 링크로 센다. */
const 파일수 = () =>
  page.evaluate(() => document.querySelectorAll('a[href^="/api/program-files/one"]').length)
const 묶음수 = () => page.evaluate(() => document.querySelectorAll("[aria-expanded]").length)

console.log("\n지원사업 서류함")
await page.goto(`${BASE}/programs/files`, { waitUntil: "networkidle0" })
await 잠깐(400)

const 첫본문 = await 본문()
확인(!/서류 목록을 읽지 못했다/.test(첫본문), "조회가 깨지지 않는다")

// 사이드바에서 닿는가 — 화면만 있고 길이 없으면 아무도 못 온다.
const 메뉴 = await page.evaluate(() =>
  [...document.querySelectorAll('a[href="/programs/files"]')].length,
)
확인(메뉴 > 0, "사이드바에 서류함 링크가 있다", `${메뉴}개`)

// 거르는 컨트롤 — 지원사업 대장과 같은 것들이 있어야 한다.
for (const a of ["서류 검색", "출처로 걸러내기", "기간 프리셋", "기간 시작", "기간 끝"]) {
  const 있나 = await page.evaluate((x) => !!document.querySelector(`[aria-label="${x}"]`), a)
  확인(있나, `필터 「${a}」가 있다`)
}

const 처음 = await 파일수()
log(`파일 ${처음}건 · 묶음 ${await 묶음수()}개`)

if (처음 === 0) {
  확인(/아직 올라온 서류가 없다|조건에 걸리는 서류가 없다/.test(첫본문), "빈 상태를 설명한다")
  log("서류가 없어 거르기·내려받기 확인은 건너뛴다(더미를 넣지 않는다)")
} else {
  확인((await 묶음수()) > 0, "사업별로 묶여 접었다 펼 수 있다")

  // 기간 — 아무것도 안 걸릴 과거 구간을 넣으면 목록이 비어야 한다.
  await page.evaluate(() => {
    const set = (a, v) => {
      const el = document.querySelector(`[aria-label="${a}"]`)
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set
      setter.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    set("기간 시작", "2000-01-01")
    set("기간 끝", "2000-12-31")
  })
  await 잠깐(300)
  확인((await 파일수()) === 0, "옛 기간을 넣으면 아무것도 안 남는다")
  확인(/조건에 걸리는 서류가 없다/.test(await 본문()), "왜 비었는지 적어 준다")

  // 초기화로 되돌아오는가.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent ?? "").trim() === "초기화",
    )
    b?.click()
  })
  await 잠깐(300)
  확인((await 파일수()) === 처음, "초기화하면 전부 돌아온다")

  // 한 번에 받기 — 진짜 zip 이 오는가(헤더까지 본다).
  const zip = await page.evaluate(async () => {
    const r = await fetch("/api/program-files/zip")
    const buf = new Uint8Array(await r.arrayBuffer())
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      disp: r.headers.get("content-disposition"),
      // zip 은 "PK\x03\x04" 로 시작한다. 200 만 보면 오류 페이지도 통과한다.
      매직: buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4,
      크기: buf.length,
    }
  })
  확인(zip.status === 200 && zip.매직, "모두 내려받기가 진짜 zip 을 준다", `${zip.크기}B`)
  확인(/filename\*=UTF-8/.test(zip.disp ?? ""), "한글 파일명을 RFC 5987 로 준다")

  // 기간을 좁혀 요청하면 zip 도 좁아져야 한다 — 보는 것과 받는 것이 어긋나면 안 된다.
  const 빈zip = await page.evaluate(async () => {
    const r = await fetch("/api/program-files/zip?from=2000-01-01&to=2000-12-31")
    return r.status
  })
  확인(빈zip === 404, "기간에 아무것도 없으면 빈 zip 을 주지 않고 알려 준다", `${빈zip}`)

  // 파일 하나 내려받기 — 서명 URL 로 넘어가는가(저장소 경로는 화면에 나오면 안 된다).
  const 한개 = await page.evaluate(async () => {
    const a = document.querySelector('a[href^="/api/program-files/one"]')
    const r = await fetch(a.getAttribute("href"), { redirect: "manual" })
    return { status: r.status, type: r.type }
  })
  확인(
    한개.status === 200 || 한개.status === 0 || 한개.type === "opaqueredirect",
    "파일 하나도 내려받을 수 있다",
    `${한개.status}/${한개.type}`,
  )
}

확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 3).join(" | "))

await browser.close()
console.log(실패 === 0 ? "\n통과" : `\n실패 ${실패}건`)
process.exit(실패 === 0 ? 0 : 1)
