// 「전체」 보기 — 세 단계를 한 표에서 보고 여러 항목으로 걸러 낸다.
//
//   ① 전체 줄 수 = 신청중 + 수행중 + 사업종료 (어느 단계에도 못 낀 과제가 없다)
//   ② 단계 열이 있고, 단계로 거르면 그 단계만 남는다
//   ③ 사업유형으로 거르면 그 유형만 남는다
//   ④ 기간 프리셋 「올해 걸친 것」은 **겹치는** 과제를 고른다 — 시작일이 올해인 것만이 아니다
//   ⑤ 직접 날짜를 넣으면 프리셋을 밀어낸다
//   ⑥ 초기화가 전부 푼다
//
// 시드 숫자를 박지 않는다. 화면에서 읽은 값끼리 비교한다.
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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1800,1200"],
  defaultViewport: { width: 1800, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 줄수 = () => page.evaluate(() => document.querySelectorAll("tbody tr").length)
const 가기 = async (p) => {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(500)
}
/** 머리글에서 자리를 찾아 그 열을 읽는다. 열 번호를 박으면 열이 늘 때 조용히 어긋난다. */
const 열읽기 = (이름) =>
  page.evaluate((h) => {
    const 머리 = [...document.querySelectorAll("thead th")].map((t) => t.textContent.trim())
    const i = 머리.indexOf(h)
    if (i < 0) return null
    return [...document.querySelectorAll("tbody tr")].map((t) => t.children[i]?.textContent?.trim() ?? "")
  }, 이름)
/** Radix Select 하나를 열어 라벨로 고른다. */
async function 고르기(aria, 라벨) {
  const 열림 = await page.evaluate((a) => {
    const t = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === a)
    t?.click()
    return !!t
  }, aria)
  if (!열림) return false
  await 잠깐(350)
  const 골랐다 = await page.evaluate((l) => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) =>
      x.textContent.trim().includes(l),
    )
    o?.click()
    return !!o
  }, 라벨)
  await 잠깐(500)
  return 골랐다
}

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  // ① 합이 맞는가
  const 셈 = {}
  for (const [이름, path] of [
    ["신청중", "/projects/applying"],
    ["수행중", "/projects"],
    ["사업종료", "/projects/closed"],
  ]) {
    await 가기(path)
    셈[이름] = await 줄수()
  }
  await 가기("/projects/all")
  const 전부 = await 줄수()
  const 합 = 셈.신청중 + 셈.수행중 + 셈.사업종료
  확인(전부 === 합, `전체 ${전부}줄 = ${셈.신청중} + ${셈.수행중} + ${셈.사업종료}`)

  // ② 단계 열 · 단계 필터
  const 단계열 = await 열읽기("단계")
  확인(!!단계열 && 단계열.length === 전부, "단계 열이 줄마다 채워져 있다")
  확인(
    !!단계열 && 단계열.every((v) => ["신청중", "수행중", "사업종료"].includes(v)),
    `단계 값이 셋 중 하나다 (${[...new Set(단계열 ?? [])].join(" · ")})`,
  )

  // 2026-09-04 부터 단계 필터는 드롭다운이 아니라 **토글 칩**이다(여러 개를 동시에 켤 수 있어야
  // 해서 — "신청중이랑 수행중만" 같은 요청, `e2e-stage-multiselect.mjs` 가 그 다중 선택 자체를
  // 본다). 여기서는 신청중·사업종료를 꺼서 수행중만 남기는 걸로 「거르는 자리가 있다」를 확인한다.
  async function 단계칩끄기(이름) {
    return page.evaluate((n) => {
      const b = [...document.querySelectorAll('[role="group"][aria-label="단계로 걸러내기"] button')].find(
        (x) => x.textContent.trim() === n,
      )
      if (!b) return false
      b.click()
      return true
    }, 이름)
  }
  const 눌림1 = await 단계칩끄기("신청중")
  const 눌림2 = await 단계칩끄기("사업종료")
  확인(눌림1 && 눌림2, "단계로 거르는 자리가 있다")
  await 잠깐(400)
  const 수행만 = await 열읽기("단계")
  확인(
    !!수행만 && 수행만.length === 셈.수행중 && 수행만.every((v) => v === "수행중"),
    `단계로 걸러진다 (${전부} → ${수행만?.length}줄, 전부 수행중)`,
  )

  // ⑥ 초기화
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("초기화"))
    b?.click()
  })
  await 잠깐(500)
  확인((await 줄수()) === 전부, `초기화하면 ${전부}줄로 돌아온다`)

  // ③ 사업유형
  const 유형있음 = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.getAttribute("aria-label") === "사업유형으로 걸러내기",
    ),
  )
  if (!유형있음) {
    log("· 사업유형이 한 종류뿐이라 ③ 은 건너뜀")
  } else {
    확인(await 고르기("사업유형으로 걸러내기", "국가 R&D"), "사업유형으로 거르는 자리가 있다")
    const 유형줄 = await 열읽기("유형")
    확인(
      !!유형줄 && 유형줄.length > 0 && 유형줄.every((v) => v === "국가 R&D"),
      `유형으로 걸러진다 (${유형줄?.length}줄, 전부 국가 R&D)`,
    )
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("초기화"))
      b?.click()
    })
    await 잠깐(500)
  }

  // ④ 기간 프리셋 — 「올해 걸친 것」은 겹치면 걸린다
  확인(await 고르기("기간 프리셋", "올해 걸친 것"), "기간 프리셋이 있다")
  const 올해 = new Date().getFullYear()
  const 기간줄 = await 열읽기("수행기간")
  const 다겹침 =
    !!기간줄 &&
    기간줄.length > 0 &&
    기간줄.every((t) => {
      const m = t.match(/(\d{4})-\d{2}-\d{2}\s*~\s*(\d{4})/)
      return m && Number(m[1]) <= 올해 && 올해 <= Number(m[2])
    })
  확인(다겹침, `올해에 걸친 과제만 남는다 (${기간줄?.length}줄)`)
  // 시작일이 올해가 아닌 줄도 남아 있어야 「겹침」이 맞게 구현된 것이다.
  const 예전시작 = (기간줄 ?? []).some((t) => Number(t.slice(0, 4)) < 올해)
  확인(예전시작, "예전에 시작해 올해까지 가는 과제도 잡힌다(겹침으로 판정)")

  // ⑤ 직접 날짜가 프리셋을 밀어낸다
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("input")].find(
      (i) => i.getAttribute("aria-label") === "기간 시작",
    )
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    set.call(el, "2030-01-01")
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await 잠깐(600)
  확인((await 줄수()) === 0, "2030년부터로 잡으면 남는 과제가 없다(직접 날짜가 이긴다)")

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("초기화"))
    b?.click()
  })
  await 잠깐(500)
  확인((await 줄수()) === 전부, "초기화가 기간까지 푼다")

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
