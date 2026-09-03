// 한도 검증 「차액 채우기」 — 안내창을 먼저 보여주고, 확인해야 저장된다.
//
// 두 갈래를 다 본다:
//   ① 연구수당(ALLOWANCE) 초과 — 비목이 하나라 후보 줄도 하나. 버튼 한 번으로 바로 안내창.
//   ② 현금 재원 부족 — 여러 비목(FACILITY·ACTIVITY)에 걸친 합계라 **어느 줄에 채울지 사람이 고른다**.
//      자동으로 아무 줄이나 골라 채우지 않는다 — 근거 없는 숫자를 만들지 않으려는 것이다.
// 그리고 저장 안 한 다른 변경이 있으면 버튼이 잠기는 것까지 확인한다(다른 편집을 덮어쓰지 않기 위해).
//
// ⚠ P01(id=2)은 시연 과제라 건드리지 않는다. 총사업비 1억짜리 테스트 과제를 새로 만든다.
import puppeteer from "puppeteer-core"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = "http://127.0.0.1:3610"
const 코드 = "E2E-AUTOFIX-001"
const 이름 = "e2e 차액채우기 테스트 과제"

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
async function post(table, rows) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: 헤더({ Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  })
  if (!r.ok) throw new Error(`${table} insert ${r.status}: ${await r.text()}`)
  return r.json()
}
async function del(table, q) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${q}`, { method: "DELETE", headers: 헤더() })
  return r.status
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1400"],
  defaultViewport: { width: 1440, height: 1400 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

const 심을것 = `
  window.__a = {
    버튼(글자) { return [...document.querySelectorAll("button")].find(b => b.textContent.trim() === 글자) ?? null },
    // 「차액 채우기」가 여러 개일 수 있어 그 앞의 글줄(할 일 문구)로 좁힌다.
    채우기버튼(문구조각) {
      const li = [...document.querySelectorAll("li")].find(x => x.textContent.includes(문구조각))
      return li ? [...li.querySelectorAll("button")].find(b => b.textContent.trim() === "차액 채우기") : null
    },
    disabled(문구조각) {
      const b = window.__a.채우기버튼(문구조각)
      return b ? b.disabled : "버튼 없음"
    },
    누르기(el) { el?.click(); return !!el },
    넣기(el, v) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    },
  }
`

let 과제id = null

try {
  과제id = (
    await post("projects", [
      {
        과제코드: 코드,
        과제명: 이름,
        사업유형: "NATIONAL_RND",
        시작일: "2026-01-01",
        종료일: "2027-12-31",
        연차: 1,
        총사업비: 100000000,
        정부지원금: 90000000,
        기관부담_현금: 10000000,
        기관부담_현물: 0,
        상태: "수행중",
        선정결과: "선정",
      },
    ])
  )[0].id
  // ⚠ PostgREST 벌크 insert 는 배열의 모든 객체 키가 같아야 한다("All object keys must match").
  //   한도비율이 있는 줄만 넣으면 400 이 난다 — 없는 줄도 null 로 명시한다.
  await post("budgets", [
    { 과제_id: 과제id, 비목_대분류: "PERSONNEL", 재원구분: "출연금", 배정액: 20000000, 한도비율: null },
    { 과제_id: 과제id, 비목_대분류: "ALLOWANCE", 재원구분: "출연금", 배정액: 5000000, 한도비율: 20 },
    { 과제_id: 과제id, 비목_대분류: "FACILITY", 재원구분: "출연금", 배정액: 65000000, 한도비율: null },
    { 과제_id: 과제id, 비목_대분류: "FACILITY", 재원구분: "현금", 배정액: 5000000, 한도비율: null },
    { 과제_id: 과제id, 비목_대분류: "ACTIVITY", 재원구분: "현금", 배정액: 3000000, 한도비율: null },
  ])
  log(
    `테스트 과제 id=${과제id} · 연구수당 초과(5,000,000/한도 4,000,000) · 현금 재원 부족(8,000,000/기준 10,000,000)`,
  )

  await page.goto(`${BASE}/projects/${과제id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)
  let text = await 본문()

  확인(text.includes("손볼 것"), "「손볼 것」 패널이 뜬다")
  확인(text.includes("연구수당이(가) 한도를 넘었습니다"), "연구수당 초과가 할 일로 잡힌다")
  확인(text.includes("현금을(를) 더 잡아야"), "현금 재원 부족이 할 일로 잡힌다")

  // ① 연구수당 — 후보 줄이 하나뿐이라 select 없이 바로 안내창
  확인(
    await page.evaluate(() => window.__a.누르기(window.__a.채우기버튼("연구수당이(가) 한도를 넘었습니다"))),
    "① [차액 채우기]를 누른다 (연구수당)",
  )
  await 잠깐(500)
  // ⚠ 배경 화면(검증 목록)에도 같은 금액·이름이 이미 떠 있어서 body 전체로 찾으면
  //   다이얼로그를 안 열어도 통과한 척한다. **다이얼로그 안쪽만** 본다.
  let 창 = await page.evaluate(() => document.querySelector('[data-slot="dialog-content"]')?.textContent ?? "")
  확인(!!창, "다이얼로그가 실제로 열렸다")
  확인(창.includes("연구수당 수정인건비"), "안내창 제목이 그 검증 이름이다")
  확인(
    창.includes("₩5,000,000") && 창.includes("₩4,000,000"),
    "안내창에 현재값→새값이 그대로 보인다",
  )
  확인(!창.includes("어느 줄에 채울까요"), "후보가 하나뿐이면 고르는 칸이 안 뜬다")

  await page.evaluate(() => window.__a.누르기(window.__a.버튼("적용하고 저장")))
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    text = await 본문()
    if (!text.includes("연구수당이(가) 한도를 넘었습니다")) break
  }
  확인(!text.includes("연구수당이(가) 한도를 넘었습니다"), "적용 후 연구수당 할 일이 사라졌다")

  const 수당행 = await pgSelect(
    "budgets",
    `과제_id=eq.${과제id}&비목_대분류=eq.ALLOWANCE&select=배정액`,
  )
  확인(Number(수당행[0]?.배정액) === 4000000, `DB 값도 한도(4,000,000)로 정확히 맞았다`)

  // ③ 저장 안 한 다른 변경이 있으면 [차액 채우기]가 잠긴다 — 현금 부족은 아직 안 풀렸으니 시험 대상이다
  await page.evaluate(심을것)
  await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label*="배정액"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, "1234")
    inp.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await 잠깐(300)
  확인(
    await page.evaluate(() => window.__a.disabled("현금을(를) 더 잡아야")) === true,
    "③ 저장 안 한 변경이 있으면 [차액 채우기]가 잠긴다",
  )
  // 방금 만든 미저장 편집은 버리고(테스트 편의를 위한 새로고침이지 기능이 아니다) 깨끗한 상태로 되돌린다.
  await page.reload({ waitUntil: "networkidle0" })
  await page.evaluate(심을것)
  확인(
    await page.evaluate(() => window.__a.disabled("현금을(를) 더 잡아야")) === false,
    "새로고침 뒤(더러움 없음)에는 다시 눌린다",
  )

  // ② 현금 재원 부족 — 후보 줄이 둘(FACILITY·ACTIVITY)이라 골라야 한다
  확인(
    await page.evaluate(() => window.__a.누르기(window.__a.채우기버튼("현금을(를) 더 잡아야"))),
    "② [차액 채우기]를 누른다 (현금 재원)",
  )
  await 잠깐(500)
  text = await 본문()
  확인(text.includes("어느 줄에 채울까요"), "후보가 둘이면 고르는 칸이 뜬다")
  const 옵션수 = await page.evaluate(() =>
    [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent.includes("현재")),
    )?.options.length,
  )
  확인(옵션수 === 2, `후보 줄 2개가 그대로 선택지로 뜬다 (${옵션수}개)`)

  // 두 번째 후보(ACTIVITY)를 골라서 적용 — FACILITY 는 그대로 남아야 한다
  await page.evaluate(() => {
    const s = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => o.textContent.includes("현재")),
    )
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
    proto.set.call(s, "1")
    s.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await 잠깐(300)
  await page.evaluate(() => window.__a.누르기(window.__a.버튼("적용하고 저장")))
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    text = await 본문()
    if (!text.includes("현금을(를) 더 잡아야")) break
  }
  확인(!text.includes("현금을(를) 더 잡아야"), "적용 후 현금 부족 할 일이 사라졌다")

  const [시설현금, 활동현금] = await Promise.all([
    pgSelect("budgets", `과제_id=eq.${과제id}&비목_대분류=eq.FACILITY&재원구분=eq.현금&select=배정액`),
    pgSelect("budgets", `과제_id=eq.${과제id}&비목_대분류=eq.ACTIVITY&재원구분=eq.현금&select=배정액`),
  ])
  확인(Number(시설현금[0]?.배정액) === 5000000, "고르지 않은 줄(FACILITY 현금)은 그대로다")
  확인(Number(활동현금[0]?.배정액) === 5000000, "고른 줄(ACTIVITY 현금)에 부족분 2,000,000이 채워졌다")

  // ⚠ 「전부 통과」는 굳이 확인하지 않는다 — 연구수당(ALLOWANCE 출연금)을 1,000,000 줄이면
  //   출연금 재원 합계도 같이 줄어서 **새 부족이 하나 생긴다.** 이게 버그가 아니라 사실이다 —
  //   한 곳을 고치면 다른 재원 검증이 새로 어긋날 수 있다는 걸 이 시나리오가 그대로 보여준다.
  //   그래서 여기서 보는 건 「내가 누른 그 문제가 풀렸는가」까지고, 그 이상을 요구하지 않는다.

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
  if (과제id != null) log(`정리: 과제 ${과제id} 삭제 ${await del("projects", `id=eq.${과제id}`)}`)
}

확인((await pgSelect("projects", "select=id")).length === 12, "과제 12건 (시드 그대로)")

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
