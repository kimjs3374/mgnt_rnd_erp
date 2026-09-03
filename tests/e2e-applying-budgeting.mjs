// 신청중 과제에서 사업비 계상이 실제로 저장까지 되는지 — 로그인해서 확인한다.
//
// 어제까지는 화면(신청 배지·「신청 금액 입력」버튼)만 있고 서버 액션이 신청중을 막고 있어서
// 버튼을 눌러도 저장이 실패했다. 그 서버 가드를 풀었으니 실제로 끝까지 되는지 본다.
//
// ⚠ 2026-09-04 — 이 흐름을 검증하던 전용 대기열 화면(「과제 계상」 · /project-budgeting)을
//   사용자 지시로 없앴다. 총사업비 입력은 과제 상세의 연구비 계상 탭(FundingShareCard 의
//   인라인 입력)으로 옮겼다 — 「신청 금액 입력」 버튼·다이얼로그도 그 카드 안 인라인 폼이
//   대신한다. 검사 대상(②「신청중도 서버가 막지 않는다」)은 같다, 자리만 바뀌었다.
//
// ⚠ RND_TEST_ID · RND_TEST_PW 환경변수가 필요하다(tests/lib/login.mjs). 코드에 적지 않는다.
import puppeteer from "puppeteer-core"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const 코드 = "E2E-APPLYING-BUDGET-001"
const 이름 = "e2e 신청중계상 테스트 과제"
const 금액 = 200000000

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

let 과제id = null

try {
  await 로그인하고(page, BASE, "/dashboard")
  log("로그인 완료")

  // 신청중 상태로 과제를 만든다 — 공고 837 을 물려서 규정 기반 자동 계산까지 본다.
  과제id = (
    await post("projects", [
      {
        과제코드: 코드,
        과제명: 이름,
        공고_id: 837,
        사업유형: "NATIONAL_RND",
        시작일: "2026-04-01",
        종료일: "2028-03-31",
        연차: 1,
        총사업비: 0,
        상태: "신청중",
        선정결과: "접수",
      },
    ])
  )[0].id
  log(`테스트 과제 id=${과제id} · 상태=신청중 · 공고=837`)

  // ① 과제 상세의 연구비 계상 탭 — 총사업비가 0이라 재원 카드가 인라인 입력을 보여준다
  await page.goto(`${BASE}/projects/${과제id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()
  확인(text.includes("신청 단계 계상입니다"), "① 계상 탭이 신청 단계임을 밝힌다(신청중 전용 안내)")
  확인(text.includes("아직 협약 금액이 아닙니다"), "협약 금액이 아니라고 못박는다")
  확인(text.includes("총사업비") && text.includes("규정으로 계산"), "재원 카드에 총사업비 인라인 입력이 있다")

  await page.evaluate((v) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("총사업비"))
    const el = label?.querySelector("input")
    if (el) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
  }, 금액.toLocaleString("ko-KR"))
  await 잠깐(300)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "규정으로 계산")
    b?.click()
  })

  // ⚠⚠ 핵심 — 예전엔 여기서 서버가 "아직 선정된 과제가 아닙니다"를 냈다.
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    text = await 본문()
    if (text.includes("정부출연금") || text.includes("아직 선정된")) break
  }
  확인(!text.includes("아직 선정된 과제가 아닙니다"), "② 서버가 더 이상 신청중을 거부하지 않는다")
  확인(text.includes("정부출연금") && text.includes("75"), "규정 계산이 뜬다(공고 837 · 75% 상한)")

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "저장")
    b?.click()
  })
  await 잠깐(1500)
  확인(page.url().includes(`/projects/${과제id}/budget`), `③ 저장 후에도 계상 화면에 그대로 있다 — ${page.url()}`)

  // ④ DB 로 실제 저장 확인
  const [p] = await pgSelect("projects", `id=eq.${과제id}&select=*`)
  확인(Number(p.총사업비) === 금액, `DB 총사업비 ${Number(p.총사업비).toLocaleString("ko-KR")}원`)
  확인(p.상태 === "신청중", "저장 후에도 상태는 신청중 그대로다(임의로 안 바뀜)")
  const 합 = Number(p.정부지원금 ?? 0) + Number(p.기관부담_현금 ?? 0) + Number(p.기관부담_현물 ?? 0)
  확인(합 === 금액, `재원 합계가 총사업비와 정확히 같다(${합.toLocaleString("ko-KR")}원)`)
  const 출연비율 = (Number(p.정부지원금 ?? 0) / 금액) * 100
  확인(출연비율 <= 75.0001, `정부출연 비율 ${출연비율.toFixed(1)}% — 공고 규정(75% 이내)`)

  // ⑤ 계상 탭에서 재원 카드가 실제로 계산값을 보여주는지(화면으로 재확인)
  await page.goto(`${BASE}/projects/${과제id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  text = await 본문()
  확인(!text.includes("총사업비가 비어 있어"), "계상 탭에 더 이상 「총사업비가 비어 있다」 경고가 없다")
  확인(text.includes("정부출연금"), "재원 구성 카드가 값을 보여준다")

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
  if (과제id != null) {
    log(`정리: 예산 ${await del("budgets", `과제_id=eq.${과제id}`)}`)
    log(`정리: 과제 ${과제id} 삭제 ${await del("projects", `id=eq.${과제id}`)}`)
  }
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
