// 과제 계상 — 공고 → 선정 → **협약금액 확정** → 연구비 계상 으로 이어지는지 본다.
//
// 진짜로 봐야 할 것은 「저장된다」가 아니라 **연동이 실제로 일어나는가**다:
//   ① 선정됐지만 총사업비가 0인 건이 「사업비 미확정」으로 잡히는가
//   ② 협약금액을 넣으면 **그 공고의 규정**으로 정부출연금·민간부담이 나뉘는가
//   ③ 근거(쪽수·원문)가 화면에 같이 나오는가 — 숫자만 나오면 근거를 못 댄다
//   ④ 저장 뒤 연구비 계상 화면으로 이어지는가
//
// 선정 직후 상태를 만들려고 **총사업비 0 · 상태 수행중 · 공고 837 연결**인 과제를 하나 넣는다.
// 이건 `[지원 등록]` → `[선정]` 이 만드는 것과 같은 모양이다(`app/actions/apply.ts`).
// ⚠ 시드 12건은 건드리지 않는다. 만든 것은 반드시 지운다.
import puppeteer from "puppeteer-core"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = "http://127.0.0.1:3610"
const 이름 = "e2e 계상연동 테스트 과제"
const 코드 = "E2E-BUDGETING-001"
/** (제2026-57호) 2026년 지역혁신선도기업육성(R&D) — funding_share_rules 에 이 공고 전용 규칙이 있다. */
const 공고 = 837
const 협약금액 = 200000000

const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말, 곁 = "") => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}${곁 ? ` — ${곁}` : ""}`)
}

function 헤더(extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Accept-Profile": "app",
    "Content-Profile": "app",
    "Content-Type": "application/json",
    ...extra,
  }
}

async function 과제만들기() {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/projects`, {
    method: "POST",
    headers: 헤더({ Prefer: "return=representation" }),
    body: JSON.stringify([
      {
        과제코드: 코드,
        과제명: 이름,
        공고_id: 공고,
        사업유형: "NATIONAL_RND",
        시작일: "2026-04-01",
        종료일: "2028-03-31",
        연차: 1,
        // ⚠ 여기가 핵심 — [지원 등록]은 협약 전이라 0을 넣는다. 그 0을 재현한다.
        총사업비: 0,
        상태: "수행중",
        선정결과: "선정",
        선정결과일: "2026-03-20",
      },
    ]),
  })
  if (!res.ok) throw new Error(`과제 생성 실패 ${res.status}: ${await res.text()}`)
  return (await res.json())[0].id
}

async function 과제지우기(id) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/projects?id=eq.${id}`, {
    method: "DELETE",
    headers: 헤더(),
  })
  return r.status
}

/**
 * 관심 공고를 잠시 심는다. **실측 시점에 watchlist 가 0건**이라(사람이 지웠거나 재수집으로
 * 공고 id 가 다시 매겨졌다) 실데이터에 기대면 이 화면을 검증할 수 없다. 끝나면 지운다.
 */
async function 관심심기(공고_id) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/watchlist`, {
    method: "POST",
    headers: 헤더({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([{ 종류: "공고", 참조_id: 공고_id, 메모: "e2e" }]),
  })
  if (!r.ok) throw new Error(`관심 등록 실패 ${r.status}: ${await r.text()}`)
  return (await r.json())[0].id
}

async function 관심지우기(id) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/watchlist?id=eq.${id}`, {
    method: "DELETE",
    headers: 헤더(),
  })
  return r.status
}

/** 지원한 과제가 하나도 없는 공고를 하나 고른다 — 「아직 지원 등록 안 함」 갈래를 보려고. */
async function 미지원공고() {
  const [과제, 공고] = await Promise.all([
    pgSelect("projects", "select=공고_id"),
    pgSelect("announcements", "select=id,사업명&limit=50"),
  ])
  const 쓰인 = new Set(과제.map((p) => p.공고_id).filter(Boolean))
  return 공고.find((a) => !쓰인.has(a.id)) ?? null
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1200"],
  defaultViewport: { width: 1440, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

const 심을것 = `
  window.__b = {
    넣기(el, v) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    },
    버튼(글자) {
      return [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === 글자) ?? null
    },
    누르기(글자) {
      const b = window.__b.버튼(글자)
      b?.click()
      return !!b
    },
    // 내 과제 줄에서 버튼을 찾는다. ⚠ 조상 div 부터 훑지 않는다 — 바깥 레이아웃이 먼저 걸린다.
    줄버튼(과제명, 글자) {
      const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(과제명))
      if (!tr) return null
      return [...tr.querySelectorAll("button")].find((b) => b.textContent.trim() === 글자) ?? null
    },
  }
`

let 과제id = null
let 관심ids = []
let 미지원 = null

try {
  과제id = await 과제만들기()
  미지원 = await 미지원공고()
  관심ids.push(await 관심심기(공고))
  if (미지원) 관심ids.push(await 관심심기(미지원.id))
  log(`선정 직후 상태를 만든다: id=${과제id} · 총사업비 0`)

  await page.goto(`${BASE}/project-budgeting`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)
  let text = await 본문()

  확인(text.includes("과제 계상"), "화면이 뜬다")
  확인(text.includes(이름), "선정된 과제가 목록에 있다")

  // ⓪ 관심 공고가 **표보다 먼저** 나와야 한다 — 계상보다 앞 단계라 위에 둔다
  확인(text.includes("관심 공고"), "관심 공고 구역이 있다")
  확인(
    text.indexOf("관심 공고") < text.indexOf("사업비 미확정"),
    "관심 공고가 계상 표보다 위에 있다",
  )
  확인(text.includes("선정 ·"), "관심 공고에 지원·선정 상태가 붙는다")
  if (미지원) {
    확인(text.includes("아직 지원 등록 안 함"), "지원 안 한 관심 공고는 그렇게 말한다")
  }

  // ① 단계 판정 — 총사업비 0 은 「미계상」이 아니라 「사업비 미확정」이어야 한다
  const 줄 = await page.evaluate(
    (n) => [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(n))?.textContent ?? "",
    이름,
  )
  확인(줄.includes("사업비 미확정"), "총사업비 0 은 「사업비 미확정」으로 잡힌다", 줄.slice(0, 70))
  확인(줄.includes("공고 규정 적용"), "공고에서 온 건이라 공고 규정이 붙는다고 표시한다")

  // ①-2 검색 — 과제명·과제코드·공고명으로 좁힌다
  const 전체행 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  await page.evaluate(() => {
    const el = document.querySelector('input[placeholder*="검색"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "계상연동")
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await 잠깐(400)
  const 검색행 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  확인(검색행 === 1 && 전체행 > 1, `과제명 검색이 ${전체행}행 → ${검색행}행으로 좁힌다`)

  // 과제코드로도 찾혀야 한다 — 사람은 코드로도 뒤진다
  await page.evaluate((코드) => {
    const el = document.querySelector('input[placeholder*="검색"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, 코드)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }, 코드)
  await 잠깐(400)
  확인(
    (await page.evaluate(() => document.querySelectorAll("tbody tr").length)) === 1,
    "과제코드로도 찾힌다",
  )

  // 없는 말을 넣으면 빈 상태를 말해 준다 — 조용히 빈 표를 보여주지 않는다
  await page.evaluate(() => {
    const el = document.querySelector('input[placeholder*="검색"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "zzzz없는말zzzz")
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await 잠깐(400)
  확인((await 본문()).includes("조건에 맞는 과제가 없습니다"), "결과가 없으면 이유를 말한다")

  // 초기화
  await page.evaluate(() => window.__b.누르기("↺ 초기화"))
  await 잠깐(400)
  확인(
    (await page.evaluate(() => document.querySelectorAll("tbody tr").length)) === 전체행,
    "초기화하면 전부 돌아온다",
  )

  // 단계 필터 — 「손이 필요한 것만」이면 완료 건이 빠진다
  await page.evaluate(() => {
    const s = [...document.querySelectorAll("select")].find((x) =>
      x.textContent.includes("손이 필요한 것만"),
    )
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "미완료")
    s.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await 잠깐(400)
  const 미완료행 = await page.evaluate(() => document.querySelectorAll("tbody tr").length)
  확인(미완료행 < 전체행 && 미완료행 >= 1, `단계 필터가 ${전체행}행 → ${미완료행}행 (완료 제외)`)
  await page.evaluate(() => window.__b.누르기("↺ 초기화"))
  await 잠깐(400)

  // ② 협약금액 확정 대화상자
  확인(
    await page.evaluate((n) => {
      const b = window.__b.줄버튼(n, "협약금액 확정")
      b?.click()
      return !!b
    }, 이름),
    "[협약금액 확정] 을 연다",
  )
  await 잠깐(600)
  await page.evaluate(심을것)
  text = await 본문()
  확인(text.includes("이 공고의 재원 분담 규정"), "어느 규정이 적용되는지 먼저 말한다")

  // ③ 금액 넣고 규정으로 계산 — 저장 전에 근거를 보여줘야 한다
  await page.evaluate((v) => {
    const el = [...document.querySelectorAll('[data-slot="dialog-content"] input')][0]
    window.__b.넣기(el, v)
  }, 협약금액.toLocaleString("ko-KR"))
  await 잠깐(300)
  확인(
    await page.evaluate(() => window.__b.버튼("저장하고 계상하러 가기")?.disabled === true),
    "계산 전에는 저장이 잠겨 있다 (근거 없이 저장 못 한다)",
  )

  await page.evaluate(() => window.__b.누르기("규정으로 계산"))
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    text = await 본문()
    if (text.includes("정부출연금") && text.includes("민간부담 현금")) break
  }
  확인(text.includes("정부출연금") && text.includes("민간부담 현물"), "재원 세 칸을 미리 보여준다")
  확인(text.includes("정부출연 상한"), "계산 근거(상한·절사)를 같이 보여준다")
  확인(/p\.\d+|공고|유의사항|기준/.test(text), "근거에 규정 원문·출처가 붙어 있다")

  // ④ 저장 → 연구비 계상 화면으로
  await page.evaluate(() => window.__b.누르기("저장하고 계상하러 가기"))
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    if (page.url().includes("/budget")) break
  }
  확인(page.url().includes(`/projects/${과제id}/budget`), `저장 뒤 계상 화면으로 간다 — ${page.url()}`)

  // ⑤ DB 에 실제로 나뉘어 들어갔는가 — 화면 말고 데이터로 확인한다
  const [p] = await pgSelect("projects", `id=eq.${과제id}&select=*`)
  확인(Number(p.총사업비) === 협약금액, `총사업비 ${Number(p.총사업비).toLocaleString("ko-KR")}원`)
  const 합 = Number(p.정부지원금 ?? 0) + Number(p.기관부담_현금 ?? 0) + Number(p.기관부담_현물 ?? 0)
  확인(
    합 === 협약금액,
    `재원 합계가 총사업비와 정확히 같다 (${합.toLocaleString("ko-KR")}원)`,
    `출연 ${Number(p.정부지원금 ?? 0).toLocaleString("ko-KR")} · 현금 ${Number(p.기관부담_현금 ?? 0).toLocaleString("ko-KR")} · 현물 ${Number(p.기관부담_현물 ?? 0).toLocaleString("ko-KR")}`,
  )
  // 공고 837 · 중소기업 규칙은 정부출연 75% 이내다. 규정 기본값(97.8%)이 아니라 공고가 이겨야 한다.
  const 출연비율 = (Number(p.정부지원금 ?? 0) / 협약금액) * 100
  확인(출연비율 <= 75.0001, `정부출연 비율 ${출연비율.toFixed(1)}% — 공고 규정(75% 이내)이 적용됐다`)

  // ⑥ 단계가 「미계상」으로 넘어갔는가 — 이제 비목을 나눌 기준이 생겼다
  await page.goto(`${BASE}/project-budgeting`, { waitUntil: "networkidle0", timeout: 60000 })
  const 줄후 = await page.evaluate(
    (n) => [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(n))?.textContent ?? "",
    이름,
  )
  확인(줄후.includes("계상 전"), "단계가 「계상 전」으로 넘어갔다", 줄후.slice(0, 70))

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
  // ⚠ id 로만 지운다. 이름·like 로 지우면 남의 과제를 쓸어 간다.
  if (과제id != null) log(`정리: 과제 ${과제id} 삭제 ${await 과제지우기(과제id)}`)
  for (const id of 관심ids) log(`정리: 관심 ${id} 삭제 ${await 관심지우기(id)}`)
}

const 남은 = await pgSelect("projects", `과제코드=eq.${코드}&select=id`)
확인(남은.length === 0, `테스트가 남긴 과제 ${남은.length}건`)
const 전체 = await pgSelect("projects", "select=id")
확인(전체.length === 12, `과제 ${전체.length}건 (시드 12건 그대로)`)
const 남은관심 = await pgSelect("watchlist", "메모=eq.e2e&select=id")
확인(남은관심.length === 0, `테스트가 남긴 관심 ${남은관심.length}건`)

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
