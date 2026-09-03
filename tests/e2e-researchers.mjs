// 내부 연구원 명부 → 인건비 계상으로 바로 넣기.
//
//   ① 명부에 등록·수정된다(성명 · 연구자등록번호 · 입사일자 · 연봉)
//   ② 연봉이 **월급여 = 연봉 ÷ 12** 로 환산돼 보인다
//   ③ 연봉을 **연도별로 쌓는다** — 기준연도를 바꿔 저장해도 지난 해 값이 안 지워진다
//   ④ 인건비 계상에서 **골라 넣으면** 이름·등록번호·월급여가 채워진다
//   ⑤ 참여율·참여개월수는 **안 채운다** — 과제마다 다른 값이라 명부가 알 수 없다
//
// 만든 연구원은 끝에 지운다. **과제 데이터는 건드리지 않는다**(계상은 저장하지 않는다).
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const 과제 = 11 // 신청중. 계상 화면이 열려 있다
const 이름 = `E2E연구원${Date.now().toString().slice(-5)}`
const 등록번호 = `R-E2E-${Date.now().toString().slice(-6)}`
const 연봉 = 60000000 // 월급여 5,000,000
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

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 본문 = () => page.evaluate(() => document.body.innerText)
const 채우기 = (label, 값) =>
  page.evaluate(
    ({ label, 값 }) => {
      const el = [...document.querySelectorAll("input")].find(
        (i) => (i.getAttribute("aria-label") ?? "") === label,
      )
      if (!el) return false
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      s.call(el, 값)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      return true
    },
    { label, 값 },
  )
const 누르기 = (글) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t)
    b?.click()
    return !!b
  }, 글)

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  // ① 등록
  await page.goto(`${BASE}/researchers`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(500)
  확인((await 본문()).includes("가명"), "개인정보 안내(가명을 쓰라)가 보인다")
  확인(await 누르기("+ 연구원 등록"), "등록 버튼이 있다")
  await 잠깐(400)
  확인(await 채우기("연구원 성명", 이름), "성명 칸이 있다")
  확인(await 채우기("연구자등록번호", 등록번호), "연구자등록번호 칸이 있다")
  확인(await 채우기("입사일자", "2023-04-03"), "입사일자 칸이 있다")
  확인(await 채우기("연봉", String(연봉)), "연봉 칸이 있다")
  await 잠깐(300)

  // ② 월급여 환산이 폼에서 바로 보인다
  확인((await 본문()).includes("5,000,000"), "연봉을 월급여(÷12)로 환산해 보여 준다")

  확인(await 누르기("저장"), "저장 버튼이 있다")
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    if ((await 본문()).includes("저장했습니다")) break
  }
  // ⚠ **표 안**을 본다. 성공 메시지에 이름이 들어 있어서 화면 전체 글자로 재면
  //   목록이 아직 안 바뀌었는데도 「떴다」로 읽힌다(처음에 그렇게 통과했다).
  let 표글 = ""
  for (let i = 0; i < 20; i++) {
    표글 = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].map((t) => t.innerText).join("\n"),
    )
    if (표글.includes(이름)) break
    await 잠깐(400)
  }
  확인(표글.includes(이름), "명부 목록에 뜬다(저장하면 표가 바로 바뀐다)")
  확인(표글.includes(등록번호), "연구자등록번호가 보인다")
  확인(표글.includes("2023-04-03"), "입사일자가 보인다")

  // ③ 연봉 이력 — 기준연도를 하나 낮춰 저장하면 두 해가 같이 남는다
  const 올해 = new Date().getFullYear()
  await page.evaluate((n) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((t) => t.innerText.includes(n))
    const b = [...(tr?.querySelectorAll("button") ?? [])].find((x) => x.textContent.includes("고치기"))
    b?.click()
  }, 이름)
  await 잠깐(500)
  await 채우기("연봉 기준연도", String(올해 - 1))
  await 채우기("연봉", "50000000")
  await 누르기("저장")
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    if ((await 본문()).includes("저장했습니다")) break
  }
  const 이력줄 = await page.evaluate((n) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((t) => t.innerText.includes(n))
    return tr?.innerText ?? ""
  }, 이름)
  확인(
    이력줄.includes(String(올해)) && 이력줄.includes(String(올해 - 1)),
    `연봉이 연도별로 쌓인다 (${올해} · ${올해 - 1})`,
  )

  // ④⑤ 계상에서 골라 넣기
  await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  const 전줄 = await page.evaluate(
    () => [...document.querySelectorAll("input")].filter((i) => i.getAttribute("aria-label") === "표시명").length,
  )
  const 골랐나 = await page.evaluate((n) => {
    const sel = [...document.querySelectorAll("select")].find(
      (s) => s.getAttribute("aria-label") === "명부에서 연구원 넣기",
    )
    if (!sel) return "select 없음"
    const opt = [...sel.options].find((o) => o.textContent.includes(n))
    if (!opt) return "그 사람이 목록에 없음"
    const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
    set.call(sel, opt.value)
    sel.dispatchEvent(new Event("change", { bubbles: true }))
    return "ok"
  }, 이름)
  확인(골랐나 === "ok", `명부에서 고를 수 있다 (${골랐나})`)
  await 잠깐(600)

  // ⚠ 연구자등록번호는 **「상세 열 보기」에서만** 나오는 칸이다. 기본 열만 보면 DOM 에 없어서
  //   「안 채워졌다」로 잘못 읽힌다(처음에 그렇게 실패했다). 켜고 나서 읽는다.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.trim().startsWith("상세 열 보기"),
    )
    b?.click()
  })
  await 잠깐(500)

  const 넣긴줄 = await page.evaluate(() => {
    const 칸 = (label) =>
      [...document.querySelectorAll("input")].filter((i) => i.getAttribute("aria-label") === label)
    const 이름칸 = 칸("표시명")
    const i = 이름칸.length - 1
    if (i < 0) return null
    return {
      수: 이름칸.length,
      표시명: 이름칸[i]?.value ?? "",
      등록번호: 칸("연구자등록번호")[i]?.value ?? "",
      월급여: 칸("월급여")[i]?.value ?? "",
      참여율: 칸("참여율")[i]?.value ?? "",
      참여개월수: 칸("참여개월수")[i]?.value ?? "",
    }
  })
  확인(!!넣긴줄 && 넣긴줄.수 === 전줄 + 1, `줄이 하나 늘었다 (${전줄} → ${넣긴줄?.수})`)
  확인(넣긴줄?.표시명 === 이름, `이름이 채워졌다 (${넣긴줄?.표시명})`)
  확인(넣긴줄?.등록번호 === 등록번호, `연구자등록번호가 채워졌다 (${넣긴줄?.등록번호})`)
  확인(
    (넣긴줄?.월급여 ?? "").replace(/[^\d]/g, "") === "4166666",
    `월급여가 연봉÷12 로 채워졌다 (${넣긴줄?.월급여}) — 5,000만/12`,
  )
  확인(
    Number(넣긴줄?.참여율 || 0) === 0 && Number(넣긴줄?.참여개월수 || 0) === 0,
    "참여율·참여개월수는 안 채운다(과제마다 다른 값이라 짐작하지 않는다)",
  )
  log("· 계상은 **저장하지 않는다** — 과제 데이터를 안 건드린다")

  // 정리 — 명부에서 지운다
  await page.goto(`${BASE}/researchers`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(500)
  await page.evaluate((n) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((t) => t.innerText.includes(n))
    const b = [...(tr?.querySelectorAll("button") ?? [])].find((x) => x.textContent.includes("삭제"))
    b?.click()
  }, 이름)
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    if ((await 본문()).includes("지웠습니다")) break
  }
  // ⚠ **표 안**만 본다. 성공 메시지가 「E2E연구원… 을(를) 지웠습니다」라 이름을 품고 있어서
  //   화면 전체 글자로 재면 지워도 「아직 있다」로 읽힌다(처음에 그렇게 실패했다).
  //   지운 뒤 표가 다시 그려질 때까지 기다린다 — 서버를 한 번 더 다녀온다.
  let 표에남음 = true
  for (let i = 0; i < 25; i++) {
    표에남음 = await page.evaluate(
      (n) => [...document.querySelectorAll("tbody tr")].some((t) => t.innerText.includes(n)),
      이름,
    )
    if (!표에남음) break
    await 잠깐(400)
  }
  확인(!표에남음, "테스트로 만든 연구원을 지웠다(표에서 사라졌다)")

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
