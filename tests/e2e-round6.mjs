// 2026-09-04 사용자 요청 6건 검증 — 가운뎃점 · 삭제 반영 · 한도[%] · 적합 색칠 · 연구원 통합
//
// 진짜로 봐야 할 것은 「화면에 글자가 있다」가 아니라 **값이 실제로 바뀌는가**다.
// 특히 ②는 서버 동기화 버그라 DB 를 직접 확인한다(화면 글자로는 증명되지 않는다).
//
// ⚠ 시드 12건은 건드리지 않는다. 스크래치 과제를 만들어 쓰고 **끝에 반드시 지운다**
//   (과제를 지우면 budgets·personnel_costs 가 cascade 로 같이 지워진다).
import puppeteer from "puppeteer-core"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const 이름 = "e2e 라운드6 테스트 과제"
const 코드 = `E2E-ROUND6-${Date.now().toString().slice(-6)}`

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

async function 넣기(table, rows) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: 헤더({ Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  })
  if (!r.ok) throw new Error(`${table} 생성 실패 ${r.status}: ${await r.text()}`)
  return r.json()
}

async function 지우기(table, query) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { method: "DELETE", headers: 헤더() })
}

/** 그 과제의 인건비 비목 줄. ②는 이 값이 0 으로 내려오는지가 전부다. */
async function 인건비줄(과제_id) {
  const rows = await pgSelect("budgets", `과제_id=eq.${과제_id}&비목_대분류=eq.PERSONNEL`)
  return rows.map((b) => ({ 재원: b.재원구분, 배정: Number(b.배정액) }))
}

let 과제_id = null
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1400"],
  defaultViewport: { width: 1600, height: 1400 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 기다림 = async (조건, 초 = 25) => {
  for (let i = 0; i < 초 * 2; i++) {
    if (조건(await 본문())) return true
    await 잠깐(500)
  }
  return false
}
const 누르기 = async (글자) => {
  const ok = await page.evaluate((t) => {
    const 후보 = [...document.querySelectorAll("button")]
    const el = 후보.find((b) => (b.innerText ?? "").trim() === t) ??
      후보.find((b) => (b.innerText ?? "").trim().includes(t))
    if (!el) return false
    el.click()
    return true
  }, 글자)
  if (!ok) throw new Error(`「${글자}」 버튼을 못 찾았다`)
  await 잠깐(400)
}
/**
 * aria-label 로 칸을 찾아 값을 넣는다. 열 번호를 박지 않는다.
 *
 * ⚠ `type="date"` 칸에는 **타이핑이 안 통한다**(브라우저가 자기 형식으로만 받는다).
 *   React 가 알아채게 **네이티브 setter + input 이벤트**로 넣는다 — value 만 바꾸면
 *   React 의 상태는 그대로라 다음 렌더에 되돌아간다.
 */
const 채우기 = async (label, value, 번째 = 0) => {
  const ok = await page.evaluate(
    (l, v, n) => {
      const el = document.querySelectorAll(`[aria-label="${l}"]`)[n]
      if (!el) return false
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      setter?.call(el, String(v))
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    },
    label,
    value,
    번째,
  )
  if (!ok) throw new Error(`「${label}」 칸이 없다`)
  await 잠깐(150)
}
/** 넣은 값이 실제로 들어갔는지 읽어 본다. 안 들어간 채로 다음 단계를 재면 원인을 놓친다. */
const 값 = (label, 번째 = 0) =>
  page.evaluate(
    (l, n) => document.querySelectorAll(`[aria-label="${l}"]`)[n]?.value ?? null,
    label,
    번째,
  )

try {
  // ── 셋업: 스크래치 과제 + 한도 걸리는 비목 두 줄 ─────────────────────────
  const [과제] = await 넣기("projects", [
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
      상태: "수행중",
      선정결과: "선정",
    },
  ])
  과제_id = 과제.id
  log(`스크래치 과제 ${과제_id} (${코드})`)

  // 연구수당 한도 20% · 간접비 한도 10% — 「입력 몇 %」와 색칠을 보려면 한도 줄이 있어야 한다.
  await 넣기("budgets", [
    { 과제_id, 비목_대분류: "FACILITY", 재원구분: "현금", 배정액: 50000000, 한도비율: null },
    { 과제_id, 비목_대분류: "ALLOWANCE", 재원구분: "현금", 배정액: 1000000, 한도비율: 20 },
    { 과제_id, 비목_대분류: "INDIRECT", 재원구분: "현금", 배정액: 40000000, 한도비율: 10 },
  ])

  await page.goto(`${BASE}/projects/${과제_id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()

  console.log("④ 한도[%] 표기와 입력값 비율")
  확인(text.includes("한도[%]"), "머리글에 단위가 대괄호로 붙는다")
  확인(/입력 \d+(\.\d+)?%/.test(text) || text.includes("입력 —"), "입력값이 몇 %인지 같이 찍힌다",
    (text.match(/입력 [^\n]*/g) ?? []).slice(0, 3).join(" | "))

  console.log("⑤ 적합/부적합 색칠")
  const 색 = await page.evaluate(() => {
    const 줄 = [...document.querySelectorAll("tbody tr")]
    return 줄.map((tr) => ({
      글: (tr.innerText ?? "").split("\t")[0].slice(0, 14),
      초록: tr.className.includes("bg-green-100"),
      빨강: tr.className.includes("bg-red-100"),
    }))
  })
  const 초록수 = 색.filter((r) => r.초록).length
  const 빨강수 = 색.filter((r) => r.빨강).length
  확인(초록수 + 빨강수 > 0, "판정이 있는 줄에 색이 칠해진다", `초록 ${초록수} · 빨강 ${빨강수}`)
  // 간접비 40,000,000 은 (직접비 51,000,000 − 현물 0) 기준 10% 한도(약 4,636,363)를 크게 넘는다.
  확인(빨강수 > 0, "한도를 넘긴 줄은 연빨강이다", 색.filter((r) => r.빨강).map((r) => r.글).join(" | "))
  확인(
    색.some((r) => !r.초록 && !r.빨강),
    "판정 규칙이 없는 비목은 칠하지 않는다(거짓 초록을 만들지 않는다)",
  )

  console.log("⑥ 연구원 명부가 계상 탭 안에 있다")
  확인(text.includes("연구원 명부"), "인건비 표 아래에 명부가 있다")
  확인(
    await page.evaluate(() => !document.querySelector('a[href="/researchers"]')),
    "사이드바에서 「연구원」이 빠졌다",
  )
  확인(
    await page.evaluate(() => !!document.querySelector("details")),
    "펼쳐 보는 형태다(계상 화면을 밀어내지 않는다)",
  )

  console.log("① 참여시작일 + 개월수 → 참여종료일 자동")
  await 누르기("+ 인원 추가")
  await 채우기("표시명", "e2e연구원")
  await 채우기("월급여", "4000000")
  await 채우기("참여율", "25")
  await 채우기("참여개월수", "6")
  await 채우기("참여시작일", "2026-01-01")
  log(
    `넣은 값: 월급여 ${await 값("월급여")} · 참여율 ${await 값("참여율")} · ` +
      `개월 ${await 값("참여개월수")} · 시작 ${await 값("참여시작일")}`,
  )
  확인((await 값("참여시작일")) === "2026-01-01", "시작일이 실제로 들어갔다")
  const 종료일 = await 값("참여종료일")
  확인(종료일 === "2026-06-30", "시작일 + 6개월 = 2026-06-30 (끝일 −1일)", 종료일 || "빈칸")

  console.log("② 저장하면 비목 인건비가 생기고, 지우면 0 으로 내려온다")
  // 기본 재원구분은 **현물**이다(그 사람이 실제로 급여를 받지 않는 기관부담이 기본).
  // 재원을 가리지 않고 **인건비 줄 합계**로 재면 기본값이 바뀌어도 이 검사가 안 깨진다.
  const 합 = (줄) => 줄.reduce((s, r) => s + r.배정, 0)
  // ⚠ 버튼 이름은 「인건비 저장」이다. 「저장」으로 찾으면 아래 비목 표의 「계상 저장」이 먼저 걸린다.
  await 누르기("인건비 저장")
  const 저장됨 = await 기다림((t) => t.includes("저장했습니다"))
  if (!저장됨) {
    // 실패하면 **화면이 뭐라고 했는지** 찍는다. 원인을 모르면 다음 검사는 의미가 없다.
    const 말 = (await 본문())
      .split("\n")
      .filter((l) => /습니다|없습니다|초과|오류|실패/.test(l))
      .slice(0, 4)
      .join(" / ")
    log(`화면 메시지: ${말 || "(없음)"}`)
  }
  확인(저장됨, "저장됐다")
  await 잠깐(1500)
  let 줄 = await 인건비줄(과제_id)
  확인(
    합(줄) === 6000000,
    "저장 → 비목 인건비 6,000,000 (월급여 4,000,000 × 25% × 6개월)",
    줄.map((r) => `${r.재원} ${r.배정.toLocaleString("ko-KR")}`).join(" · ") || "줄 없음",
  )

  await page.reload({ waitUntil: "networkidle0" })
  await 잠깐(600)
  // 「삭제」는 비목 표에도 있다. **개인별 인건비 카드 안에서만** 누른다.
  const 지웠나 = await page.evaluate(() => {
    const 카드 = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("rounded-lg") && d.textContent?.includes("개인별 인건비 계상"),
    )
    const b = [...(카드?.querySelectorAll("button") ?? [])].find(
      (x) => (x.innerText ?? "").trim() === "삭제",
    )
    if (!b) return false
    b.click()
    return true
  })
  확인(지웠나, "개인별 표의 [삭제]를 눌렀다")
  확인(await 기다림((t) => !t.includes("e2e연구원"), 20), "사람이 목록에서 사라졌다")
  await 잠깐(1800)
  줄 = await 인건비줄(과제_id)
  확인(
    줄.length > 0 && 합(줄) === 0,
    "★ 지우면 비목 인건비가 0 으로 내려온다(그대로 남지 않는다)",
    줄.map((r) => `${r.재원} ${r.배정}`).join(" · ") || "줄 없음",
  )
  확인(줄.length > 0, "줄 자체는 남는다 — 왜 줄었는지 화면에서 보여야 한다")

  console.log("①(대장) 신청중 줄의 가운뎃점")
  await page.goto(`${BASE}/projects/applying`, { waitUntil: "networkidle0", timeout: 60000 })
  const 액션 = await page.evaluate(() => {
    const 머리 = [...document.querySelectorAll("thead th")].map((t) => t.textContent.trim())
    const i = 머리.length - 1 // 마지막 열이 액션 칸
    return [...document.querySelectorAll("tbody tr")].map((tr) => ({
      글: (tr.children[i]?.textContent ?? "").trim(),
      가운데: (tr.children[i]?.className ?? "").includes("text-center"),
    }))
  })
  확인(
    액션.length > 0 && 액션.every((a) => !a.글.includes("·")),
    "신청중 줄에 가운뎃점이 없다",
    액션.map((a) => JSON.stringify(a.글)).join(" | "),
  )
  확인(액션.every((a) => a.가운데), "액션 칸이 가운데 정렬이다")

  await page.goto(`${BASE}/projects/closed`, { waitUntil: "networkidle0", timeout: 60000 })
  const 종료액션 = await page.evaluate(() => {
    const i = document.querySelectorAll("thead th").length - 1
    return [...document.querySelectorAll("tbody tr")].map((tr) =>
      (tr.children[i]?.textContent ?? "").trim(),
    )
  })
  확인(
    종료액션.length > 0 && 종료액션.every((t) => t === "정산"),
    "사업종료 줄은 「정산」만 있고 가운뎃점이 없다",
    종료액션.join(" | "),
  )

  확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  ✗ 예외 — ${e.message}`)
  실패++
} finally {
  if (과제_id) {
    await 지우기("personnel_costs", `과제_id=eq.${과제_id}`)
    await 지우기("budgets", `과제_id=eq.${과제_id}`)
    await 지우기("projects", `id=eq.${과제_id}`)
    const 남음 = await pgSelect("projects", `id=eq.${과제_id}`)
    console.log(`  ${남음.length ? "✗" : "✓"} 정리 — 스크래치 과제를 지웠다`)
    if (남음.length) 실패++
  }
  await browser.close()
}

console.log()
if (실패) {
  console.log(`✗ 실패 ${실패}건`)
  process.exit(1)
}
console.log("✓ 전 항목 통과")
