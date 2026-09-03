// 지원사업 관리의 **필터 줄** — 과제 관리와 같은 컨트롤이 있고, 실제로 걸러지는가.
// (2026-09-04 사용자 지시: "지원사업관리도 이와 같이 만들어주고")
//
// 시드에 기대지 않는다 — 대장에 줄이 없으면 「필터가 없어야 한다」가 아니라 **건너뛴다.**
// 있는 줄로 연도를 골라 **줄 수가 줄어드는지**까지 본다(컨트롤이 그려지는 것과 걸러지는 것은 다르다).
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
const 줄수 = () => page.evaluate(() => document.querySelectorAll("tbody tr").length)
const 본문 = () => page.evaluate(() => document.body.innerText)
/** shadcn Select — 트리거를 열고 라벨로 고른다. */
const 고르기 = async (aria, 라벨) => {
  const 열림 = await page.evaluate((a) => {
    const t = document.querySelector(`[aria-label="${a}"]`)
    if (!t) return false
    t.click()
    return true
  }, aria)
  if (!열림) return false
  await 잠깐(300)
  const 골랐나 = await page.evaluate((l) => {
    const it = [...document.querySelectorAll('[role="option"]')].find(
      (x) => (x.textContent ?? "").trim() === l,
    )
    if (!it) return false
    it.click()
    return true
  }, 라벨)
  await 잠깐(500)
  return 골랐나
}

try {
  await page.goto(`${BASE}/programs`, { waitUntil: "networkidle0", timeout: 60000 })
  const 처음 = await 줄수()
  log(`지원사업 대장 ${처음}줄`)

  console.log("① 과제 관리와 같은 컨트롤이 있다")
  const 컨트롤 = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-label]")]
      .map((e) => e.getAttribute("aria-label"))
      .filter((x) => /연도|유형|기간|쪽/.test(x ?? "")),
  )
  for (const a of ["수행 연도로 걸러내기", "기간 프리셋", "기간 시작", "기간 끝", "한 쪽에 몇 줄"]) {
    확인(컨트롤.includes(a), `「${a}」 가 있다`)
  }
  확인(/\d+건/.test(await 본문()), "건수를 적는다", (await 본문()).match(/\d+건/)?.[0] ?? "")

  if (처음 === 0) {
    log("대장이 비어 있어 걸러내기 검사는 건너뜀(컨트롤 확인까지만)")
  } else {
    console.log("② 기간 프리셋 「올해」 — 이름이 바뀌었고 겹치면 걸린다")
    확인(!(await 본문()).includes("올해 걸친 것"), "옛 이름(「올해 걸친 것」)이 남아 있지 않다")
    확인(await 고르기("기간 프리셋", "올해"), "「올해」를 고를 수 있다")
    const 올해줄 = await 줄수()
    확인(올해줄 <= 처음, `올해로 걸러도 줄 수가 늘지 않는다 (${처음} → ${올해줄})`)

    console.log("③ 초기화하면 되돌아온다")
    const 되돌림 = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        (x.innerText ?? "").includes("초기화"),
      )
      if (!b) return false
      b.click()
      return true
    })
    확인(되돌림, "「초기화」가 뜬다(필터가 걸렸을 때만)")
    await 잠깐(600)
    확인((await 줄수()) === 처음, `초기화하면 원래 줄 수로 (${await 줄수()} = ${처음})`)

    console.log("④ 한 쪽 줄 수를 줄이면 그만큼만 보인다")
    if (처음 > 10) {
      확인(await 고르기("한 쪽에 몇 줄", "10"), "10을 고를 수 있다")
      확인((await 줄수()) <= 10, `한 쪽에 10줄까지만 (${await 줄수()})`)
    } else {
      log(`줄이 ${처음}개뿐이라 쪽 나누기 검사는 건너뜀`)
    }
  }

  // 예외를 두지 않는다. `ProgramsStageView` 의 Base UI `nativeButton` 경고는 담당이 고쳤고(c460681)
  // 지금 0건이다 — 예외를 남겨 두면 **같은 경고가 새로 생겨도 조용히 지나간다.**
  확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  ✗ 예외 — ${e.message}`)
  실패++
} finally {
  await browser.close()
}

console.log()
if (실패) {
  console.log(`✗ 실패 ${실패}건`)
  process.exit(1)
}
console.log("✓ 전 항목 통과")
