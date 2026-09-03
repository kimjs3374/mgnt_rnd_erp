// 개인별 인건비 → 비목 인건비 **자동 반영**, 그리고 화면 순서.
//
//   ① 개인별 인건비 카드가 비목 계상 표보다 **위**에 있다 (근거가 결과보다 위)
//   ② 사람을 넣고 저장하면 **누르지 않아도** 아래 비목 인건비가 그 합계로 바뀐다
//   ③ 비목 표의 인건비 칸은 **잠긴다** — 여기서 고치면 다음 저장에 덮이기 때문이다
//   ④ 「인건비 비목으로 반영」 버튼은 없다 (저장이 곧 반영)
//
// ⚠ **과제 13(종료 과제)에서만 쓴다.** P01(id 2)은 시연 주인공이라 안 건드린다.
//   이 테스트는 과제 13 의 PERSONNEL 배정액을 **실제로 바꾼다.** 끝에 복구 SQL 을 찍는다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const 과제 = 13
const 이름 = "이몽룡" // 표준 더미. 실명을 쓰지 않는다.
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}`)
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1400"],
  defaultViewport: { width: 1700, height: 1400 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 본문 = () => page.evaluate(() => document.body.innerText)

/**
 * 비목 표에서 **인건비(PERSONNEL)** 줄만 읽는다.
 * ⚠ 「학생인건비」도 「인건비」를 포함한다 — `includes` 로 잡으면 그 줄까지 섞여서
 *   「인건비 칸이 안 잠긴다」는 거짓 실패가 난다. 맨 앞부터 맞는지 본다.
 */
const 인건비줄 = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")]
      .filter((tr) => (tr.children[0]?.textContent ?? "").trim().startsWith("인건비"))
      .map((tr) => ({
        비목: tr.children[0]?.textContent?.trim() ?? "",
        재원: tr.children[1]?.textContent?.trim() ?? "",
        금액: tr.children[2]?.textContent?.trim() ?? "",
        입력칸: !!tr.children[2]?.querySelector("input"),
      })),
  )

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(600)

  // ① 순서 — 개인별 카드가 비목 표보다 위에 있는가.
  // ⚠ `innerText.indexOf` 로 재면 안 된다. 「연구비 계상」은 화면 제목·브레드크럼에도 있어서
  //   본문 순서와 무관하게 맨 앞에 잡힌다(처음에 그렇게 짰다가 거짓 실패를 봤다).
  //   **실제 화면 좌표**로 잰다.
  // 인원이 0명일 때도 잡히는 자리를 기준으로 쓴다 — 「+ 인원 추가」는 늘 있다.
  // (표시명 입력칸을 기준으로 삼았더니 빈 표에서는 못 찾았다.)
  const 순서 = await page.evaluate(() => {
    const 추가 = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.trim().startsWith("+ 인원 추가"),
    )
    const 비목칸 = [...document.querySelectorAll("tbody tr")].find((tr) =>
      (tr.children[0]?.textContent ?? "").trim().startsWith("인건비"),
    )
    if (!추가 || !비목칸) return null
    return { 개인별: 추가.getBoundingClientRect().top, 비목: 비목칸.getBoundingClientRect().top }
  })
  확인(
    !!순서 && 순서.개인별 < 순서.비목,
    순서
      ? `개인별 인건비가 비목 표보다 위에 있다 (y ${Math.round(순서.개인별)} < ${Math.round(순서.비목)})`
      : "두 카드를 못 찾았다",
  )

  // ④ 수동 반영 버튼이 없어졌는가
  const 버튼있나 = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.includes("비목으로 반영")),
  )
  확인(!버튼있나, "「인건비 비목으로 반영」 버튼이 없다(저장이 곧 반영)")
  확인((await 본문()).includes("자동으로 맞춰집니다"), "저장하면 자동으로 맞춰진다고 알려 준다")

  const 전 = await 인건비줄()
  log(`드롭 전 인건비 줄: ${전.map((r) => `${r.재원} ${r.금액}`).join(" · ") || "없음"}`)
  console.log(
    `\n  ⚠ 복구 SQL (테스트 끝나고 반드시 실행):\n` +
      전
        .map(
          (r) =>
            `  ./db/psql.sh -c "update app.budgets set 배정액=${r.금액.replace(/[^\d]/g, "")} where 과제_id=${과제} and 비목_대분류='PERSONNEL' and 재원구분='${r.재원}'"`,
        )
        .join("\n") +
      "\n",
  )

  // ② 사람을 넣고 저장 — 4,000,000 × 25% × 6개월 = 6,000,000, 미지급이라 현물
  await page.evaluate((v) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "+ 인원 추가")
    b?.click()
  })
  await 잠깐(400)
  const 넣었나 = await page.evaluate((v) => {
    const set = (el, val) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      s.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const 칸 = (label) =>
      [...document.querySelectorAll("input")].find((i) => (i.getAttribute("aria-label") ?? "") === label)
    const 이름칸 = 칸("표시명")
    if (!이름칸) return false
    set(이름칸, v.이름)
    const 급여 = 칸("월급여")
    const 율 = 칸("참여율")
    const 개월 = 칸("참여개월수")
    if (급여) set(급여, "4000000")
    if (율) set(율, "25")
    if (개월) set(개월, "6")
    return true
  }, { 이름 })
  확인(넣었나, "인원 한 줄을 넣었다")
  await 잠깐(400)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("인건비 저장"))
    b?.click()
  })
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    if ((await 본문()).includes("저장했습니다")) break
  }
  const 저장말 = await 본문()
  확인(저장말.includes("저장했습니다"), "저장됐다")
  확인(저장말.includes("맞췄습니다"), "얼마로 맞췄는지 말해 준다")

  // 서버가 다시 그려 준 화면에서 비목 인건비를 확인한다
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  const 후 = await 인건비줄()
  log(`반영 후 인건비 줄: ${후.map((r) => `${r.재원} ${r.금액}`).join(" · ")}`)
  const 현물 = 후.find((r) => r.재원 === "현물")
  확인(
    !!현물 && 현물.금액.replace(/[^\d]/g, "") === "6000000",
    `비목 인건비(현물)가 개인별 합계로 저절로 바뀌었다 (${현물?.금액})`,
  )

  // ③ 잠겼는가
  확인(
    후.length > 0 && 후.every((r) => !r.입력칸),
    "비목 표의 인건비 칸은 못 고친다(개인별에서 고친다)",
  )
  확인((await 본문()).includes("개인별에서 자동"), "그 줄이 어디서 오는지 적혀 있다")

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
