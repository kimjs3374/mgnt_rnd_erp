// 신청완료의 **갈림길** — 선정이면 수행중으로, 미선정이면 신청완료에 남는다.
// (2026-09-04 사용자 지시) 만든 과제는 끝나고 지운다.
import puppeteer from "puppeteer-core"
import { readFileSync } from "node:fs"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const env = Object.fromEntries(
  readFileSync("/web/rnd/.env.local", "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const K = env.SUPABASE_SERVICE_ROLE_KEY
const H = {
  apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json",
  "Accept-Profile": "app", "Content-Profile": "app", Prefer: "return=representation",
}
const rest = (p, o = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: H, ...o })

const 표 = `E2E-PICK-${Math.floor(Math.random() * 100000)}`
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => { if (!ok) 실패++; log(`${ok ? "✓" : "✗"} ${말}`) }

// ── 준비: 신청완료(발표심사) 두 건
const 만들 = ["선정될것", "떨어질것"].map((n) => ({
  과제명: `${표} ${n}`, 과제코드: `${표}-${n}`, 상태: "신청중", 선정결과: "발표심사",
  사업유형: "NATIONAL_RND",
  // ⚠ 시작일·종료일·총사업비는 NOT NULL 이다. 신청 건이라 기간은 「예정」으로 넣는다 —
  //    종료일을 과거로 두면 단계 판정이 사업종료로 떨어져 이 테스트가 뜻을 잃는다.
  시작일: "2026-10-01", 종료일: "2027-09-30", 총사업비: 0, 연차: 1,
}))
const 만든 = await (await rest("projects", { method: "POST", body: JSON.stringify(만들) })).json()
if (!Array.isArray(만든) || 만든.length !== 2) {
  console.log("준비 실패:", JSON.stringify(만든).slice(0, 300)); process.exit(1)
}
const ids = 만든.map((r) => r.id)
console.log(`   준비: 과제 ${ids.join(" · ")} (${표})`)

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1300 },
})
const page = await browser.newPage()
const 오류 = []
page.on("pageerror", (e) => 오류.push(String(e)))
page.on("console", (m) => m.type() === "error" && 오류.push(m.text()))
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

async function 줄찾기(이름) {
  return page.evaluate((n) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(n))
    return tr ? tr.innerText.replace(/\n/g, " | ").slice(0, 200) : null
  }, 이름)
}
async function 버튼누르기(이름, 글) {
  return page.evaluate((n, g) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(n))
    const b = [...(tr?.querySelectorAll("button") ?? [])].find((x) => x.innerText.trim() === g)
    b?.click()
    return !!b
  }, 이름, 글)
}
async function 예누르기() {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("tbody button")].find((x) => x.innerText.trim() === "예")
    b?.click()
    return !!b
  })
}

try {
  await 로그인하고(page, BASE)

  console.log("① 신청완료에 갈림길 두 개가 보인다")
  await page.goto(`${BASE}/projects/applied`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  확인(!!(await 줄찾기(`${표} 선정될것`)), "신청완료 목록에 있다")
  const 갈림 = await page.evaluate((n) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(n))
    return [...(tr?.querySelectorAll("button") ?? [])].map((b) => b.innerText.trim())
  }, `${표} 선정될것`)
  확인(갈림.includes("선정"), `「선정」 버튼이 있다 (${갈림.join(" · ")})`)
  확인(갈림.includes("미선정"), "「미선정」 버튼이 있다 — 둘 중 하나를 고른다")

  console.log("② 미선정 → 신청완료에 **남는다**")
  확인(await 버튼누르기(`${표} 떨어질것`, "미선정"), "미선정을 눌렀다")
  await 잠깐(400)
  확인(await 예누르기(), "한 번 더 묻는다 — 스치듯 눌리지 않게")
  await 잠깐(2500)
  await page.goto(`${BASE}/projects/applied`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  const 떨어진줄 = await 줄찾기(`${표} 떨어질것`)
  확인(!!떨어진줄, "**신청완료에 그대로 남아 있다** — 사라지지 않는다")
  확인(/미선정/.test(떨어진줄 ?? ""), `미선정이라고 적혀 있다 (${(떨어진줄 ?? "").slice(0, 80)})`)
  const db떨어짐 = await (await rest(`projects?id=eq.${ids[1]}&select=*`)).json()
  확인(db떨어짐[0]?.선정결과 === "미선정", `DB 선정결과=미선정 (${db떨어짐[0]?.선정결과})`)
  확인(db떨어짐[0]?.상태 === "신청중", `DB 상태는 신청중 그대로 (${db떨어짐[0]?.상태}) — 수행에 안 들어간다`)

  console.log("③ 선정 → 수행중으로 넘어간다")
  확인(await 버튼누르기(`${표} 선정될것`, "선정"), "선정을 눌렀다")
  await 잠깐(400)
  확인(await 예누르기(), "한 번 더 묻는다")
  await 잠깐(2500)
  await page.goto(`${BASE}/projects/applied`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  확인(!(await 줄찾기(`${표} 선정될것`)), "신청완료에서 빠졌다")
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  확인(!!(await 줄찾기(`${표} 선정될것`)), "**수행중 목록에 있다**")
  const db선정 = await (await rest(`projects?id=eq.${ids[0]}&select=*`)).json()
  확인(db선정[0]?.상태 === "수행중", `DB 상태=수행중 (${db선정[0]?.상태})`)
  확인(db선정[0]?.선정결과 === "선정", `DB 선정결과=선정 (${db선정[0]?.선정결과})`)

  console.log("④ 이미 결과가 난 건은 다시 못 고른다")
  await page.goto(`${BASE}/projects/applied`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)
  const 남은버튼 = await page.evaluate((n) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(n))
    return [...(tr?.querySelectorAll("button") ?? [])].map((b) => b.innerText.trim())
  }, `${표} 떨어질것`)
  확인(
    !남은버튼.includes("선정") && !남은버튼.includes("미선정"),
    `미선정 건에 갈림길이 안 보인다 (${남은버튼.join(" · ") || "버튼 없음"}) — 되돌리기를 버튼으로 주지 않는다`,
  )

  확인(오류.length === 0, `콘솔 오류 ${오류.length}건${오류.length ? `: ${오류[0].slice(0, 80)}` : ""}`)
} finally {
  await browser.close()
  for (const id of ids) await rest(`projects?id=eq.${id}`, { method: "DELETE" })
  const 남음 = await (await rest(`projects?과제코드=like.${표}*&select=id`)).json()
  console.log(`  ${Array.isArray(남음) && 남음.length === 0 ? "✓" : "✗"} 정리 — 만든 과제를 지웠다`)
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
