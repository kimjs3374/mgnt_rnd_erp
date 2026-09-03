// 증빙 **면제**(강제 정상 처리) — 사유 없이는 저장되지 않고, 저장되면 기록에 남는가.
// (2026-09-04 사용자 지시 · db/114)
//
// 진짜로 봐야 할 것: ① 빈 사유로는 저장이 막히는가 ② 면제하면 **미비 숫자에서 빠지는가**
// ③ 그런데 **기록은 남는가**(사유·처리자·이력) ④ 해제하면 다시 미비로 돌아오는가.
//
// ⚠ 시드에 기대지 않는다. 스크래치 과제·집행을 만들어 구멍을 내고, 끝에 반드시 지운다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const 거래처 = `e2e면제-${Date.now().toString().slice(-5)}`
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
let 집행_id = null

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
/** 미비 카드를 열고 내 집행 건 줄을 찾는다. */
const 카드열기 = async () => {
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.getAttribute("aria-label") ?? "").startsWith("사업비 증빙 미비"),
    )
    if (!b) return false
    b.click()
    return true
  })
  if (!ok) throw new Error("미비 카드를 못 찾았다(구멍이 없나?)")
  await 잠깐(700)
}
/** 내 줄에서 그 이름의 칩에 붙은 버튼(면제/해제)을 누른다. */
const 칩버튼 = async (서류명, 글자) => {
  const ok = await page.evaluate(
    (상호, 이름, 라벨) => {
      const li = [...document.querySelectorAll("li")].find((x) => (x.innerText ?? "").includes(상호))
      const chip = [...(li?.querySelectorAll("span") ?? [])].find(
        (sp) => (sp.innerText ?? "").trim().startsWith(이름) && sp.querySelector("button"),
      )
      const b = [...(chip?.querySelectorAll("button") ?? [])].find(
        (x) => (x.innerText ?? "").trim() === 라벨,
      )
      if (!b) return false
      b.click()
      return true
    },
    거래처,
    서류명,
    글자,
  )
  if (!ok) throw new Error(`「${서류명}」 칩의 [${글자}] 를 못 찾았다`)
  await 잠깐(400)
}
const 사유넣기 = async (값) => {
  const el = await page.$('[aria-label="면제 사유"]')
  if (!el) throw new Error("사유 칸이 안 열렸다")
  await el.click()
  await page.keyboard.type(값)
  await 잠깐(200)
}
const 저장버튼상태 = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText ?? "").trim() === "저장")
    return b ? { 있다: true, 잠김: b.disabled } : { 있다: false }
  })

try {
  const [과제] = await 넣기("projects", [
    {
      과제코드: `E2E-WAIVE-${Date.now().toString().slice(-6)}`,
      과제명: "e2e 증빙면제 테스트 과제",
      사업유형: "NATIONAL_RND",
      시작일: "2026-01-01",
      종료일: "2027-12-31",
      연차: 1,
      총사업비: 10000000,
      상태: "수행중",
      선정결과: "선정",
    },
  ])
  과제_id = 과제.id
  const [집행] = await 넣기("expenses", [
    {
      과제_id,
      비목_대분류: "FACILITY",
      거래처,
      일자: "2026-02-03",
      합계: 1200000,
      공급가액: 1090909,
      세액: 109091,
      품목: [{ 품목명: "e2e 면제 시험" }],
      재원구분: "현금",
      상태: "검토대기",
    },
  ])
  집행_id = 집행.id
  log(`스크래치 과제 ${과제_id} · 집행 ${집행_id}(${거래처})`)

  // 어느 서류를 면제할지 — 요건 표에서 이름을 가져온다(화면 문구를 박지 않는다).
  const 요건 = await pgSelect(
    "evidence_requirements",
    "집행단위=is.true&필수여부=is.true&비목_대분류=eq.FACILITY&select=id,서류명&order=순번",
  )
  확인(요건.length >= 2, `FACILITY 집행단위 필수 요건 ${요건.length}종`, 요건.map((r) => r.서류명).join(" · "))
  const 대상 = 요건[0]

  console.log("① 빈 사유로는 저장할 수 없다")
  await 카드열기()
  let text = await 본문()
  확인(text.includes(거래처), "내 집행 건이 목록에 있다")
  const 처음빈칸 = Number((text.match(/빈 칸 (\d+)/) ?? [])[1] ?? -1)
  log(`처음 빈 칸: ${처음빈칸}`)

  await 칩버튼(대상.서류명, "면제")
  const 상태 = await 저장버튼상태()
  확인(상태.있다 && 상태.잠김, "사유가 비면 [저장]이 잠겨 있다", JSON.stringify(상태))

  console.log("② 사유를 적으면 정상 처리된다")
  await 사유넣기("수의계약이라 견적의뢰서를 받지 않았다(e2e)")
  확인(!(await 저장버튼상태()).잠김, "사유를 적으면 저장이 열린다")
  await page.evaluate(() => {
    ;[...document.querySelectorAll("button")].find((x) => (x.innerText ?? "").trim() === "저장")?.click()
  })
  확인(await 기다림((t) => t.includes("정상 처리했습니다")), "처리했다고 말한다")
  확인(
    await 기다림((t) => t.includes("사유와 처리자가 기록에 남았습니다")),
    "기록에 남았다고 말한다",
  )

  console.log("③ DB 에 무엇이 남았나")
  const 이력 = await pgSelect("evidence_waivers", `집행_id=eq.${집행_id}&order=id`)
  확인(이력.length === 1 && 이력[0].동작 === "면제", "면제 행이 하나 생겼다", JSON.stringify(이력[0]?.동작))
  확인(
    (이력[0]?.사유 ?? "").includes("수의계약"),
    "사유가 그대로 저장됐다",
    이력[0]?.사유?.slice(0, 30),
  )
  확인(!!이력[0]?.행위자, "처리자가 남았다", 이력[0]?.행위자)
  const 현재 = await pgSelect("v_evidence_waiver_now", `집행_id=eq.${집행_id}`)
  확인(현재.length === 1, "지금 면제 상태로 보인다(뷰)", String(현재.length))

  console.log("④ 미비 숫자에서 빠지고, 면제로 보인다")
  await 카드열기()
  text = await 본문()
  const 나중빈칸 = Number((text.match(/빈 칸 (\d+)/) ?? [])[1] ?? -1)
  확인(나중빈칸 === 처음빈칸 - 1, `빈 칸이 하나 줄었다 (${처음빈칸} → ${나중빈칸})`)
  확인(text.includes("면제 1칸"), "면제 칸 수를 따로 보여준다")
  확인(text.includes("면제:"), "면제한 서류를 목록에 남긴다")

  console.log("⑤ 해제하면 다시 미비로 — 그것도 사유를 받는다")
  await 칩버튼(대상.서류명, "해제")
  확인((await 저장버튼상태()).잠김, "해제도 사유가 비면 저장이 잠긴다")
  await 사유넣기("사업주체가 서류를 요구한다고 회신(e2e)")
  await page.evaluate(() => {
    ;[...document.querySelectorAll("button")].find((x) => (x.innerText ?? "").trim() === "저장")?.click()
  })
  확인(await 기다림((t) => t.includes("다시 미비로 돌렸습니다")), "되돌렸다고 말한다")
  const 이력2 = await pgSelect("evidence_waivers", `집행_id=eq.${집행_id}&order=id`)
  확인(
    이력2.length === 2 && 이력2[1].동작 === "해제",
    "면제·해제가 **이력으로 쌓인다**(덮어쓰지 않는다)",
    이력2.map((r) => r.동작).join(" → "),
  )
  const 현재2 = await pgSelect("v_evidence_waiver_now", `집행_id=eq.${집행_id}`)
  확인(현재2.length === 0, "지금은 면제 상태가 아니다(뷰)", String(현재2.length))

  확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  ✗ 예외 — ${e.message}`)
  실패++
} finally {
  try {
    if (집행_id) await 지우기("evidence_waivers", `집행_id=eq.${집행_id}`)
    if (집행_id) await 지우기("expenses", `id=eq.${집행_id}`)
    if (과제_id) await 지우기("projects", `id=eq.${과제_id}`)
    const 남음 =
      (집행_id ? (await pgSelect("expenses", `id=eq.${집행_id}`)).length : 0) +
      (과제_id ? (await pgSelect("projects", `id=eq.${과제_id}`)).length : 0) +
      (집행_id ? (await pgSelect("evidence_waivers", `집행_id=eq.${집행_id}`)).length : 0)
    console.log(`  ${남음 === 0 ? "✓" : "✗"} 정리 — 만든 것이 남지 않았다`)
    if (남음 !== 0) 실패++
  } catch (e) {
    console.log(`  ✗ 정리 실패 — ${e.message}`)
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
