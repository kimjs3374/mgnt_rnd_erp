// 과제사업 대장의 걸러내기 — 종료 숨김 · 수행 연도 · 한 쪽 개수.
//
// 시드에 기대지 않는다. 화면에서 읽은 값끼리 비교한다(시드가 바뀌어도 살아남게).
//   ① 종료 숨김: 줄 수가 종료 건수만큼 줄고, 연빨강 줄이 하나도 안 남는다. 다시 누르면 되돌아온다
//   ② 수행 연도: 그 해에 걸치지 않는 과제가 빠진다. 「기간」 열로 직접 검산한다
//   ③ 한 쪽 개수: 10 을 고르면 한 쪽에 10줄을 넘지 않는다
//   ④ 초기화가 셋을 한 번에 되돌린다
import puppeteer from "puppeteer-core"

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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 줄수 = () => page.evaluate(() => document.querySelectorAll("tbody tr").length)
const 빨강수 = () =>
  page.evaluate(() => [...document.querySelectorAll("tbody tr")].filter((t) => t.className.includes("bg-red-100")).length)
/**
 * 각 줄의 수행기간 칸 — 연도 필터를 화면 값으로 검산하려고 읽는다.
 * ⚠ 열 번호를 박지 않는다. 「연구책임자」가 중간에 끼면서 한 칸씩 밀린 적이 있다.
 *   머리글에서 자리를 찾아 쓴다 — 열이 또 늘어도 안 깨진다.
 */
const 기간들 = () =>
  page.evaluate(() => {
    const 머리 = [...document.querySelectorAll("thead th")].map((t) => t.textContent.trim())
    const i = 머리.indexOf("수행기간")
    if (i < 0) return []
    return [...document.querySelectorAll("tbody tr")].map((t) => t.children[i]?.textContent?.trim() ?? "")
  })
const 누르기 = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(l))
    b?.click()
    return !!b
  }, label)

try {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(600)

  const 전체 = await 줄수()
  log(`수행중: ${전체}줄`)
  확인(전체 > 0, "표에 줄이 있다")

  // ① 단계가 나뉘었으니 **수행중 화면에는 종료가 한 줄도 없어야** 한다.
  //    (「종료 숨기기」 토글은 그래서 뺐다 — 숨길 것이 애초에 없다.)
  확인((await 빨강수()) === 0, "수행중 화면에는 연빨강(종료) 줄이 없다")

  // 종료는 사업종료 화면에 모여 있고 거기서 연빨강과 범례가 보인다.
  await page.goto(`${BASE}/projects/closed`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(500)
  const 종료줄 = await 줄수()
  확인(종료줄 > 0 && (await 빨강수()) === 종료줄, `사업종료 화면은 전부 연빨강이다 (${종료줄}줄)`)
  // ⚠ 범례 **문구**를 박지 않는다. 처음엔 「종료된 과제입니다」 한 줄이었는데
  //   단계 색이 셋(신청중 호박 · 수행중 하늘 · 종료 연빨강)으로 늘면서 표 형태로 바뀌었다.
  //   문구를 박아 두면 화면이 좋아질 때마다 테스트가 깨진다 — **있어야 할 것**만 본다:
  //   ① 색 견본이 있고 ② 「종료」를 가리키며 ③ 빨강이 문제라는 뜻이 아니라고 말한다.
  const 범례 = await page.evaluate(() => {
    const 견본 = [...document.querySelectorAll("span")].filter(
      (s) => s.className.includes("inline-block") && /bg-(red|amber|sky|orange|blue)-/.test(s.className),
    )
    return { 견본수: 견본.length, 글: document.body.innerText }
  })
  확인(범례.견본수 > 0, `범례에 색 견본이 있다 (${범례.견본수}개)`)
  확인(범례.글.includes("종료"), "그 색이 「종료」를 가리킨다고 적혀 있다")
  확인(
    /문제가 있다는 뜻이 아니|끝난 과제입니다/.test(범례.글),
    "빨강이 문제라는 뜻이 아니라고 말해 준다",
  )

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(500)

  // ② 수행 연도 — Radix Select 라 트리거를 누르고 항목을 고른다
  const 열림 = await page.evaluate(() => {
    const t = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "수행 연도로 걸러내기",
    )
    t?.click()
    return !!t
  })
  확인(열림, "「수행 연도」 고르는 자리가 있다")
  await 잠깐(400)
  const 고른해 = await page.evaluate(() => {
    const 항목 = [...document.querySelectorAll('[role="option"]')].filter((o) => /^\d{4}년$/.test(o.textContent.trim()))
    if (!항목.length) return null
    // 가운데 해를 고른다 — 맨 앞·뒤는 걸치는 과제가 하나뿐일 수 있어 검산이 헐거워진다.
    const 고름 = 항목[Math.floor(항목.length / 2)]
    const 값 = 고름.textContent.trim()
    고름.click()
    return 값
  })
  확인(!!고른해, `연도 항목이 뜬다 (고른 해: ${고른해 ?? "없음"})`)
  await 잠깐(600)
  const 연 = Number(String(고른해).replace("년", ""))
  const 기간 = await 기간들()
  const 다걸침 = 기간.every((t) => {
    const m = t.match(/(\d{4})-\d{2}-\d{2}\s*~\s*(\d{4})/)
    return m && Number(m[1]) <= 연 && 연 <= Number(m[2])
  })
  확인(기간.length > 0 && 다걸침, `${연}년에 수행 중이던 과제만 남는다 (${기간.length}줄)`)

  // ③ 한 쪽 개수 10
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "한 쪽에 볼 개수",
    )
    t?.click()
  })
  await 잠깐(400)
  const 열개 = await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.trim() === "10개씩")
    o?.click()
    return !!o
  })
  확인(열개, "「10개씩」을 고를 수 있다")
  await 잠깐(600)
  확인((await 줄수()) <= 10, `한 쪽에 10줄을 넘지 않는다 (${await 줄수()}줄)`)
  const 요약 = await page.evaluate(() => document.body.innerText.match(/\d+–\d+ \/ \d+건/)?.[0] ?? null)
  확인(!!요약, `몇 번째를 보고 있는지 적혀 있다 (${요약 ?? "없음"})`)

  // ④ 초기화
  확인(await 누르기("↺ 초기화"), "「초기화」가 있다")
  await 잠깐(600)
  확인((await 줄수()) === 전체, `셋이 한 번에 풀린다 (${전체}줄로 복귀)`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
