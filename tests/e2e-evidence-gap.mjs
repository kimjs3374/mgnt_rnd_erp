// 「사업비 증빙 미비」 카드 — 눌러서 **어느 과제의 어느 집행에 무슨 서류가 없는지** 보고,
// 그 자리로 바로 가는지 본다. (2026-09-04 사용자 지시)
//
// 숫자만 맞는지 보지 않는다 — 목록에 **서류 이름**이 있고, [채우러 가기] 가 실제로 그 집행 건을
// **펼친 채로** 여는지까지 본다. 그게 이 기능의 값어치다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

// ⚠ 시드에 기대지 않는다. 지금 집행이 1건뿐이라(재시드 중) 카드가 0 으로 뜨는데, 그 상태로
//   빨개지는 테스트는 「기능이 깨졌다」는 거짓말이 된다. **구멍을 직접 만들어** 검증하고 지운다.
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
const 거래처 = `e2e증빙구멍-${Date.now().toString().slice(-5)}`

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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1400"],
  defaultViewport: { width: 1700, height: 1400 },
})
const page = await browser.newPage()
await 로그인하고(page, BASE)
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // ── 셋업: 증빙이 필요한 비목(FACILITY)의 집행 한 건. 서류는 하나도 안 붙인다 = 구멍.
  const [과제] = await 넣기("projects", [
    {
      과제코드: `E2E-GAP-${Date.now().toString().slice(-6)}`,
      과제명: "e2e 증빙구멍 테스트 과제",
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
      품목: [{ 품목명: "e2e 시험용 장비" }],
      재원구분: "현금",
      상태: "검토대기",
    },
  ])
  집행_id = 집행.id
  log(`스크래치 과제 ${과제_id} · 집행 ${집행_id}(${거래처})`)

  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()

  console.log("① 카드가 눌리는가")
  확인(text.includes("사업비 증빙 미비"), "카드가 있다")
  const 미비수 = Number((text.match(/사업비 증빙 미비\s*\n?\s*(\d+)/) ?? [])[1] ?? -1)
  log(`카드 숫자: ${미비수}`)
  확인(미비수 >= 1, "구멍이 있으니 카드가 1 이상이다", String(미비수))
  // ⚠ 2026-09-04 사용자 지시로 카드 sub 글을 짧게 줄였다("눌러서 보기" 같은 문구를 뺐다) —
  //   누를 수 있다는 건 아래에서 aria-label·버튼 여부로 확인한다(문구가 아니라 역할로 잡는다).
  확인(/집행\s*\d+건\s*미비/.test(text), "집행 건수를 짧게 보여준다(구멍이 있을 때만)")

  const 눌렀나 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.getAttribute("aria-label") ?? "").startsWith("사업비 증빙 미비"),
    )
    if (!b) return false
    b.click()
    return true
  })
  확인(눌렀나, "카드가 버튼이다")
  await 잠깐(700)
  text = await 본문()

  console.log("② 무엇이 비었는지 말하는가")
  확인(text.includes("증빙 필수 서류:"), "빠진 서류 이름을 적는다", (text.match(/증빙 필수 서류:[^\n]*/) ?? [""])[0].slice(0, 70))
  확인(text.includes("채우러 가기"), "그 자리로 가는 링크가 있다")
  확인(text.includes(거래처), "내가 만든 집행 건이 목록에 있다", 거래처)
  확인(
    text.includes("e2e 증빙구멍 테스트 과제"),
    "어느 과제인지도 적는다",
  )
  // 단위 없는 숫자(「증빙 25」)는 사람이 못 읽는다 — 세는 단위가 **집행 건**인지 본다.
  확인(/집행 \d+건 중 \d+건에 증빙 없음/.test(text), "과제별로 얼마나 남았는지 센다",
    (text.match(/집행 \d+건 중 \d+건에 증빙 없음[^\n]*/) ?? [""])[0].slice(0, 60))

  // DB 와 대조한다 — 화면 숫자가 실제 구멍과 같은지.
  const 요건 = await pgSelect("evidence_requirements", "집행단위=is.true&필수여부=is.true&select=id,비목_대분류,서류명")
  확인(요건.length > 0, `집행단위 필수 요건 ${요건.length}종을 기준으로 센다`)
  const 서류이름들 = [...new Set(요건.map((r) => r.서류명))]
  확인(
    서류이름들.some((n) => text.includes(n)),
    "목록의 서류 이름이 요건 표에서 온 이름이다",
    서류이름들.slice(0, 4).join(" · "),
  )

  console.log("③ [채우러 가기] 가 그 집행 건을 펼친 채로 여는가")
  // 내 집행 건 줄의 링크를 고른다 — 다른 과제 것을 눌러도 통과해 버리면 검사가 헐렁해진다.
  const 링크 = await page.evaluate((상호) => {
    const li = [...document.querySelectorAll("li")].find((x) => (x.innerText ?? "").includes(상호))
    const a = [...(li?.querySelectorAll("a") ?? [])].find((x) =>
      (x.innerText ?? "").includes("채우러 가기"),
    )
    return a?.getAttribute("href") ?? null
  }, 거래처)
  확인(!!링크 && /\/projects\/\d+\/expenses\?expense=\d+/.test(링크), "링크가 집행 건을 가리킨다", 링크 ?? "없음")

  await page.goto(`${BASE}${링크}`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(900)
  text = await 본문()
  확인(
    await page.evaluate(() => !!document.querySelector('[role="dialog"]')),
    "그 집행 건의 상세가 열린 채로 시작한다",
  )
  확인(링크.includes(`expense=${집행_id}`), "링크가 내가 만든 집행 건을 가리킨다", 링크)
  확인(text.includes(거래처), "열린 것이 그 집행 건이다", 거래처)
  확인(text.includes("증빙"), "증빙 칸이 그 안에 있다")

  확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  ✗ 예외 — ${e.message}`)
  실패++
} finally {
  try {
    if (집행_id) await 지우기("expenses", `id=eq.${집행_id}`)
    if (과제_id) await 지우기("projects", `id=eq.${과제_id}`)
    const 남음 =
      (집행_id ? (await pgSelect("expenses", `id=eq.${집행_id}`)).length : 0) +
      (과제_id ? (await pgSelect("projects", `id=eq.${과제_id}`)).length : 0)
    console.log(`  ${남음 === 0 ? "✓" : "✗"} 정리 — 만든 과제·집행을 지웠다`)
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
