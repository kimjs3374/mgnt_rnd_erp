// 대장의 연구책임자 — 보이고, 고쳐지고, 새로고침해도 남는가.
//
// ⚠ **과제 13(종료 과제)에서만 쓴다.** P01(id 2)은 시연 주인공이라 건드리지 않는다
//   — 예전에 e2e 가 P01 예산을 조용히 덮어 원인을 못 찾은 적이 있다.
// 끝나면 「홍길동」으로 되돌린다. 되돌리는 것까지가 테스트다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 과제코드 = "RS-2022-00284460" // 과제 13
const 원래 = "홍길동"
const 바꿀이름 = "이몽룡" // 홍길동과 같은 결의 표준 더미. 실명을 쓰지 않는다.
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

/**
 * 과제코드로 그 줄을 찾아 연구책임자 칸(셋째 열)의 이름을 읽는다.
 * ⚠ 칸 안에 「고칠 수 있다」는 연필(✎)이 같이 들어 있어 `textContent` 에 딸려 온다. 떼고 읽는다.
 */
const 읽기 = () =>
  page.evaluate((코드) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((t) =>
      (t.children[1]?.textContent ?? "").includes(코드),
    )
    return tr ? (tr.children[2]?.textContent ?? "").replace(/✎/g, "").trim() : null
  }, 과제코드)

/** 그 줄의 연구책임자 칸을 눌러 열고, 이름을 넣고, Enter 로 저장한다. */
async function 바꾸기(이름) {
  const 열렸나 = await page.evaluate((코드) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((t) =>
      (t.children[1]?.textContent ?? "").includes(코드),
    )
    const b = tr?.children[2]?.querySelector("button")
    b?.click()
    return !!b
  }, 과제코드)
  if (!열렸나) throw new Error("연구책임자 칸을 못 찾았다")
  await 잠깐(300)
  // 값을 React 가 알아채게 네이티브 setter 로 넣는다(그냥 el.value = 는 안 먹는다).
  await page.evaluate(
    ({ 코드, 이름 }) => {
      const tr = [...document.querySelectorAll("tbody tr")].find((t) =>
        (t.children[1]?.textContent ?? "").includes(코드),
      )
      const input = tr?.children[2]?.querySelector("input")
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      set.call(input, 이름)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    },
    { 코드: 과제코드, 이름 },
  )
  await 잠깐(200)
  await page.keyboard.press("Enter") // 표 안이라 Enter 로 저장한다
  for (let i = 0; i < 30; i++) {
    await 잠깐(400)
    if ((await 읽기()) === 이름) break
  }
}

try {
  // ⚠ 과제 13 은 **종료된 과제**라 「수행중」(`/projects`)이 아니라 「사업종료」에 있다.
  //    단계로 나누기 전에는 한 대장에 다 있었다 — 그때 쓴 주소를 그대로 두면 칸을 못 찾는다.
  await page.goto(`${BASE}/projects/closed`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(600)

  확인(
    await page.evaluate(() =>
      [...document.querySelectorAll("th")].some((t) => t.textContent.trim() === "연구책임자"),
    ),
    "대장에 「연구책임자」 열이 있다",
  )
  확인((await 읽기()) === 원래, `과제 13 의 연구책임자가 ${원래} 이다 (${await 읽기()})`)

  const 전부홍길동 = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].every((t) =>
      (t.children[2]?.textContent ?? "").includes("홍길동"),
    ),
  )
  확인(전부홍길동, "모든 줄에 시드 이름이 채워져 있다")

  // 고치기
  await 바꾸기(바꿀이름)
  확인((await 읽기()) === 바꿀이름, `칸에서 바로 고쳐진다 (${원래} → ${바꿀이름})`)

  // 새로고침해도 남는가 — 화면 상태가 아니라 DB 에 들어갔는지 보는 유일한 방법이다
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(600)
  확인((await 읽기()) === 바꿀이름, "새로고침해도 남아 있다")

  // 검색으로도 잡히는가 — 이 열을 붙인 이유가 「누가 맡은 과제」를 찾는 것이다
  await page.evaluate((이름) => {
    const input = [...document.querySelectorAll("input")].find(
      (i) => i.placeholder && i.placeholder.includes("검색"),
    )
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    set.call(input, 이름)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, 바꿀이름)
  await 잠깐(500)
  const 검색줄 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  확인(검색줄 === 1, `연구책임자로 검색된다 (${검색줄}줄)`)

  // 빈 값은 막는다
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("input")].find(
      (i) => i.placeholder && i.placeholder.includes("검색"),
    )
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    set.call(input, "")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await 잠깐(500)
  await 바꾸기("")
  await 잠깐(1200)
  const 막힘 = await page.evaluate(() => document.body.innerText.includes("비워 둘 수 없습니다"))
  확인(막힘, "빈 값은 막고 이유를 말한다")
  await page.keyboard.press("Escape")
  await 잠깐(300)

  // 되돌리기
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(600)
  await 바꾸기(원래)
  확인((await 읽기()) === 원래, `${원래} 으로 되돌렸다`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
