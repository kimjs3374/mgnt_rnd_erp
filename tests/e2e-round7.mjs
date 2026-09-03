// 2026-09-04 요청 3건 — Ⓐ 차액 채우기 쓰기 쉽게 · Ⓑ 한도 초과 못 넣게 · Ⓒ 신규채용 기본 판정
//
// 값이 실제로 바뀌는지를 본다. 특히 Ⓑ 는 「경고를 띄운다」가 아니라 **칸의 값이 상한으로 맞춰지는가**다.
//
// ⚠ 시드는 건드리지 않는다. 스크래치 과제·연구원을 만들어 쓰고 **끝에 반드시 지운다.**
//   신규채용 기준을 사업유형(NATIONAL_RND)으로 저장하는 검사가 있어 그 규칙도 되돌린다 —
//   안 지우면 12개 과제의 기본값이 바뀐 채로 남는다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const 코드 = `E2E-ROUND7-${Date.now().toString().slice(-6)}`
const 이름 = "e2e 라운드7 테스트 과제"
const 최근입사 = "2024-06-01" // 기준일 2026-01-01 · 3년이면 신규, 1년이면 기존
const 오래된입사 = "2015-03-02"

const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말, 곁 = "") => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}${곁 ? ` — ${곁}` : ""}`)
}

const 헤더 = (extra = {}) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Accept-Profile": "app",
  "Content-Profile": "app",
  "Content-Type": "application/json",
  ...extra,
})
const 넣기 = async (table, rows) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: 헤더({ Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  })
  if (!r.ok) throw new Error(`${table} 생성 실패 ${r.status}: ${await r.text()}`)
  return r.json()
}
const 지우기 = (table, q) =>
  fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${q}`, { method: "DELETE", headers: 헤더() })

let 과제_id = null
let 연구원ids = []

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1500"],
  defaultViewport: { width: 1700, height: 1500 },
})
const page = await browser.newPage()
await 로그인하고(page, BASE)
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 기다림 = async (조건, 초 = 20) => {
  for (let i = 0; i < 초 * 2; i++) {
    if (조건(await 본문())) return true
    await 잠깐(500)
  }
  return false
}
const 누르기 = async (글자) => {
  const ok = await page.evaluate((t) => {
    const 후보 = [...document.querySelectorAll("button")]
    const el =
      후보.find((b) => (b.innerText ?? "").trim() === t) ??
      후보.find((b) => (b.innerText ?? "").trim().includes(t))
    if (!el || el.disabled) return false
    el.click()
    return true
  }, 글자)
  if (!ok) throw new Error(`「${글자}」 버튼을 못 찾았거나 잠겨 있다`)
  await 잠깐(400)
}
/** 배정액 칸(원 단위 콤마)에 값을 넣는다 — 실제 키보드로 쳐야 포맷·보정 로직을 탄다. */
const 배정액넣기 = async (번째, 값) => {
  const els = await page.$$('input[inputmode="numeric"]')
  const el = els[번째]
  if (!el) throw new Error(`배정액 칸 ${번째} 이 없다`)
  await el.click({ clickCount: 3 })
  await page.keyboard.type(String(값))
  await 잠깐(300)
  return page.evaluate((i) => document.querySelectorAll('input[inputmode="numeric"]')[i]?.value, 번째)
}

try {
  // ── 셋업 ────────────────────────────────────────────────────────────────
  const [과제] = await 넣기("projects", [
    {
      과제코드: 코드,
      과제명: 이름,
      사업유형: "NATIONAL_RND",
      시작일: "2026-01-01", // 공고일이 없으니 이게 기준일이 된다
      종료일: "2027-12-31",
      연차: 1,
      총사업비: 100000000,
      정부지원금: 100000000,
      상태: "수행중",
      선정결과: "선정",
    },
  ])
  과제_id = 과제.id
  await 넣기("budgets", [
    { 과제_id, 비목_대분류: "PERSONNEL", 재원구분: "현금", 배정액: 50000000, 한도비율: null },
    { 과제_id, 비목_대분류: "ALLOWANCE", 재원구분: "현금", 배정액: 1000000, 한도비율: 20 },
    { 과제_id, 비목_대분류: "INDIRECT", 재원구분: "현금", 배정액: 1000000, 한도비율: 10 },
  ])
  const 사람들 = await 넣기("researchers", [
    { 표시명: "e2e최근입사", 입사일자: 최근입사, 연봉: 48000000, 재직: true },
    { 표시명: "e2e오래된입사", 입사일자: 오래된입사, 연봉: 60000000, 재직: true },
  ])
  연구원ids = 사람들.map((r) => r.id)
  log(`스크래치 과제 ${과제_id} · 연구원 ${연구원ids.join(",")}`)

  await page.goto(`${BASE}/projects/${과제_id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()

  // ── Ⓒ 신규채용 기준 ─────────────────────────────────────────────────────
  console.log("Ⓒ 신규채용 기준 — 공고일 기준 입사 N년")
  확인(text.includes("신규채용 기준"), "기준을 화면에서 보여준다")
  확인(
    text.includes("공고일이 없어 협약 시작일"),
    "무엇을 기준일로 썼는지 말한다(공고일이 비어 있다)",
    (text.match(/신규채용 기준[^\n]*/) ?? [""])[0].slice(0, 80),
  )
  확인(text.includes("제안 — 사업주체 공고문으로 확인하세요"), "기본값(제안)임을 밝힌다")
  확인(
    (await page.evaluate(
      () => document.querySelector('[aria-label="신규채용 기준연수"]')?.value,
    )) === "3",
    "기본 기준연수는 3년",
  )

  console.log("Ⓒ 명부에서 넣으면 판정해서 켜 준다")
  const 명부넣기 = async (id) => {
    await page.evaluate((v) => {
      const sel = document.querySelector('[aria-label="명부에서 연구원 넣기"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
      setter?.call(sel, String(v))
      sel.dispatchEvent(new Event("change", { bubbles: true }))
    }, id)
    await 잠깐(600)
  }
  const 체크들 = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="신규채용 여부"]')].map((c) => c.checked),
    )

  await 명부넣기(연구원ids[0])
  text = await 본문()
  확인((await 체크들()).at(-1) === true, `입사 ${최근입사} → 신규채용이 켜진다(3년 이내)`)
  확인(text.includes("3년 이내"), "왜 켰는지 근거를 말한다", (text.match(/입사 [^\n]*/) ?? [""])[0].slice(0, 90))

  await 명부넣기(연구원ids[1])
  확인((await 체크들()).at(-1) === false, `입사 ${오래된입사} → 신규채용이 꺼진다`)
  text = await 본문()
  확인(text.includes("기존 인원"), "그 판정도 근거와 함께 말한다")

  console.log("Ⓒ 기준은 사업주체마다 다르다 — 고쳐서 저장한다")
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="신규채용 기준연수"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(el, "1")
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await 잠깐(200)
  await 누르기("기준 저장")
  확인(await 기다림((t) => t.includes("1년으로 저장했습니다")), "저장했다고 말한다")
  const 규칙 = await pgSelect("new_hire_rules", "적용범위=eq.사업유형")
  확인(
    규칙.length === 1 && Number(규칙[0].기준연수) === 1 && 규칙[0].상태 === "확정",
    "사업유형 규칙으로 저장되고 「확정」이 된다",
    JSON.stringify(규칙[0] ?? null),
  )

  await page.reload({ waitUntil: "networkidle0" })
  await 잠깐(500)
  await 명부넣기(연구원ids[0])
  확인(
    (await 체크들()).at(-1) === false,
    `기준을 1년으로 바꾸면 입사 ${최근입사} 는 이제 기존 인원`,
  )

  // ── Ⓑ 한도 초과 방지 ────────────────────────────────────────────────────
  console.log("Ⓑ 연구수당·간접비는 한도[%]를 넘겨 넣을 수 없다")
  text = await 본문()
  const 칸수 = await page.evaluate(() => document.querySelectorAll('input[inputmode="numeric"]').length)
  log(`숫자 칸 ${칸수}개`)
  // 비목 표의 배정액 칸을 찾는다 — 연구수당 줄의 칸 번호를 머리글이 아니라 값으로 짚는다.
  const 연구수당칸 = await page.evaluate(() => {
    const 칸 = [...document.querySelectorAll('input[inputmode="numeric"]')]
    return 칸.findIndex((i) => (i.getAttribute("aria-label") ?? "").includes("연구수당"))
  })
  확인(연구수당칸 >= 0, "연구수당 배정액 칸을 찾았다", String(연구수당칸))
  const 넣은뒤 = await 배정액넣기(연구수당칸, "20000000")
  확인(
    넣은뒤 === "10,000,000",
    "한도(인건비 50,000,000 × 20% = 10,000,000)로 맞춰진다",
    `칸의 값 ${넣은뒤}`,
  )
  확인(
    await 기다림((t) => t.includes("한도 ₩10,000,000 까지만 넣을 수 있습니다")),
    "왜 값이 바뀌었는지 말한다(조용히 자르지 않는다)",
  )

  // ── Ⓐ 차액 채우기 ───────────────────────────────────────────────────────
  console.log("Ⓐ 차액 채우기 — 저장 안 한 변경이 있어도 쓸 수 있다")
  text = await 본문()
  확인(text.includes("저장하지 않은 변경이 있습니다"), "지금은 저장 안 한 상태다(잠기던 조건)")
  const 버튼상태 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.innerText ?? "").trim() === "차액 채우기",
    )
    return b ? { 있다: true, 잠김: b.disabled } : { 있다: false }
  })
  확인(버튼상태.있다 && !버튼상태.잠김, "차액 채우기가 잠겨 있지 않다", JSON.stringify(버튼상태))

  await 누르기("차액 채우기")
  확인(await 기다림((t) => t.includes("차액 채우기")), "확인창이 뜬다(조용히 넣지 않는다)")
  await 누르기("적용하고 표에 넣기")
  확인(
    await 기다림((t) => t.includes("아직 저장 전입니다")),
    "표에만 넣고 저장은 사람에게 맡긴다",
  )

  확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  ✗ 예외 — ${e.message}`)
  실패++
} finally {
  // ── 정리 ────────────────────────────────────────────────────────────────
  try {
    if (과제_id) {
      await 지우기("personnel_costs", `과제_id=eq.${과제_id}`)
      await 지우기("budgets", `과제_id=eq.${과제_id}`)
      await 지우기("projects", `id=eq.${과제_id}`)
    }
    for (const id of 연구원ids) await 지우기("researchers", `id=eq.${id}`)
    // ★ 사업유형 규칙을 지운다 — 안 지우면 12개 과제의 신규채용 기본값이 1년으로 남는다.
    await 지우기("new_hire_rules", "적용범위=eq.사업유형")

    const 남은과제 = 과제_id ? await pgSelect("projects", `id=eq.${과제_id}`) : []
    const 남은규칙 = await pgSelect("new_hire_rules", "적용범위=eq.사업유형")
    const 공통 = await pgSelect("new_hire_rules", "적용범위=eq.공통")
    const ok = 남은과제.length === 0 && 남은규칙.length === 0 && 공통.length === 1
    console.log(
      `  ${ok ? "✓" : "✗"} 정리 — 과제 ${남은과제.length} · 사업유형 규칙 ${남은규칙.length} · 공통 규칙 ${공통.length}(1이어야 함)`,
    )
    if (!ok) 실패++
  } catch (e) {
    console.log(`  ✗ 정리 실패 — ${e.message} (수동 확인 필요)`)
    실패++
  }
  await browser.close()
}

console.log()
if (실패) {
  console.log(`✗ 실패 ${실패}건`)
  process.exit(1)
}
console.log("✓ 전 항목 통과")
