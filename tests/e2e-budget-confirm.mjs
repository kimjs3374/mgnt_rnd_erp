// 계상 확정 → 관리 위치 이동 → 읽기 전용, 그리고 서식(문서 통일화).
//
// 봐야 할 것은 「버튼이 눌린다」가 아니라 **잠금이 실제로 잠기는가**다:
//   ① 합계가 안 맞으면 확정할 수 없다
//   ② 확정하면 사업 대장으로 데려간다 — 말로만 「관리 위치가 바뀐다」고 하지 않는다
//   ③ 확정 뒤 계상 탭은 입력칸이 사라진다(볼 수만)
//   ④ 확정 사실이 DB 에 정확히 한 줄 남고 계상 금액이 그대로다 (서버 잠금 자체는 ④ 주석 참조)
//   ⑤ 해제는 사유 없이 안 된다
//   ⑥ 서식: 서류 줄에 양식을 올리면 「양식 받기」가 생기고, 서명 URL 로 내려간다
//
// ⚠ P01(id=2)은 시연 과제다. **여기서 확정했다 풀면 이력이 남는다** — 그래서 쓰지 않고
//   총사업비·계상까지 갖춘 테스트 과제를 따로 만든다. 끝나면 지운다.
import puppeteer from "puppeteer-core"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = "http://127.0.0.1:3610"
const 코드 = "E2E-CONFIRM-001"
const 이름 = "e2e 계상확정 테스트 과제"
const 총사업비 = 100000000

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
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${q}`, {
    method: "DELETE",
    headers: 헤더(),
  })
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
  window.__c = {
    버튼(글자) {
      return [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === 글자) ?? null
    },
    누르기(글자) { const b = window.__c.버튼(글자); b?.click(); return !!b },
    넣기(el, v) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    },
    // 서식 줄 — 서류명으로 찾아 그 li 를 돌려준다. 조상에서 훑지 않는다.
    서식줄(서류명) {
      return [...document.querySelectorAll("li")].find((li) => li.textContent.includes(서류명)) ?? null
    },
    dt(name) {
      const d = new DataTransfer()
      d.items.add(new File(["%PDF-1.4\\n%%EOF"], name, { type: "application/pdf" }))
      return d
    },
    보내기(el, 종류, dataTransfer) {
      el.dispatchEvent(new DragEvent(종류, { bubbles: true, cancelable: true, dataTransfer }))
    },
  }
`

let 과제id = null

/**
 * 시작 시점의 과제 수. **「12건」을 박지 않는다.**
 *
 * 12 는 시드 개수인데, 공고에서 [지원 등록]을 누르면 대장에 진짜 과제가 늘어난다 —
 * 그게 이 제품의 기능이다. 숫자를 박아 두면 **사람이 기능을 쓰는 순간 테스트가 빨개지고**,
 * 다음 사람이 「잔여물이 남았나」 하고 남의 실제 데이터를 지우게 된다(실제로 그럴 뻔했다:
 * 과제 55 「삼성 EPC 3사 …」는 사람이 화면에서 등록한 건이지 테스트 잔여가 아니었다).
 * 이 테스트가 봐야 하는 것은 **「내가 만든 것을 내가 다 치웠는가」**뿐이다.
 */
const 시작과제수 = (await pgSelect("projects", "select=id")).length
let 양식ids = []

try {
  // 총사업비 1억 · 계상 9천만(합계 불일치 상태)으로 시작한다 — ①을 보려고 일부러 어긋나게 둔다.
  과제id = (
    await post("projects", [
      {
        과제코드: 코드,
        과제명: 이름,
        사업유형: "NATIONAL_RND",
        시작일: "2026-01-01",
        종료일: "2027-12-31",
        연차: 1,
        총사업비,
        정부지원금: 75000000,
        기관부담_현금: 2500000,
        기관부담_현물: 22500000,
        상태: "수행중",
        선정결과: "선정",
      },
    ])
  )[0].id
  await post("budgets", [
    { 과제_id: 과제id, 비목_대분류: "FACILITY", 재원구분: "출연금", 배정액: 90000000 },
  ])
  log(`테스트 과제 id=${과제id} · 총사업비 1억 · 계상 9천만(불일치)`)

  await page.goto(`${BASE}/projects/${과제id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)
  let text = await 본문()

  확인(text.includes("계상 진행 중"), "확정 전에는 「계상 진행 중」으로 뜬다")
  확인(text.includes("10,000,000원 남음"), "얼마가 남았는지 말해 준다")
  확인(
    await page.evaluate(() => window.__c.버튼("계상 확정")?.disabled === true),
    "① 합계가 안 맞으면 [계상 확정]이 잠겨 있다",
  )
  확인(!text.includes("비목별 증빙 파일"), "「비목별 증빙 파일」 항목이 빠졌다")
  확인(text.includes("서식 (문서 통일화)"), "그 자리에 서식 카드가 들어왔다")

  // 합계를 맞춘다
  await post("budgets", [
    { 과제_id: 과제id, 비목_대분류: "ACTIVITY", 재원구분: "출연금", 배정액: 10000000 },
  ])
  await page.reload({ waitUntil: "networkidle0" })
  await page.evaluate(심을것)
  확인(
    await page.evaluate(() => window.__c.버튼("계상 확정")?.disabled === false),
    "합계가 맞으면 확정할 수 있다",
  )

  // ⑥ 서식 — 드래그드랍으로 표준 양식 등록
  const 서류 = "검수조서"
  const 드롭됨 = await page.evaluate((s) => {
    const li = window.__c.서식줄(s)
    if (!li) return "줄 없음"
    window.__c.보내기(li, "dragenter", window.__c.dt("e2e-검수조서-양식.pdf"))
    window.__c.보내기(li, "dragover", window.__c.dt("e2e-검수조서-양식.pdf"))
    window.__c.보내기(li, "drop", window.__c.dt("e2e-검수조서-양식.pdf"))
    return "보냄"
  }, 서류)
  if (드롭됨 === "줄 없음") {
    확인(false, `서식 목록에 「${서류}」 줄이 없다`)
  } else {
    for (let i = 0; i < 40; i++) {
      await 잠깐(500)
      text = await 본문()
      if (text.includes("양식 받기")) break
    }
    확인(text.includes("양식 받기"), "⑥ 서류 줄에 양식을 놓으면 표준으로 등록된다")
    확인(text.includes("표준 양식을 등록했습니다"), "등록됐다고 말해 준다")
    const t = await pgSelect("form_templates", `서류명=eq.${encodeURIComponent(서류)}&select=id,파일명`)
    양식ids = t.map((x) => x.id)
    확인(t.length === 1, `표준은 서류당 하나 (${t[0]?.파일명 ?? "없음"})`)
  }

  // ② 확정 → 사업 대장으로 데려간다
  await page.evaluate(() => window.__c.누르기("계상 확정"))
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    if (page.url().endsWith("/projects")) break
  }
  확인(page.url().endsWith("/projects"), `② 확정하면 사업 대장으로 간다 — ${page.url()}`)

  // ③ 계상 탭은 읽기 전용
  await page.goto(`${BASE}/projects/${과제id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)
  text = await 본문()
  확인(text.includes("계상 확정됨"), "③ 확정 배너가 뜬다")
  확인(text.includes("관리 위치는"), "관리 위치가 사업 대장이라고 말한다")
  확인(
    await page.evaluate(() => window.__c.버튼("계상 저장") == null),
    "[계상 저장] 버튼이 사라졌다",
  )
  확인(
    await page.evaluate(() => window.__c.버튼("협약 금액으로 저장") == null),
    "재원 구성 저장 버튼도 사라졌다",
  )
  const 금액칸 = await page.evaluate(
    () => [...document.querySelectorAll('input[aria-label*="배정액"]')].length,
  )
  확인(금액칸 === 0, `배정액 입력칸이 없다 (${금액칸}개)`)

  // ④ 확정된 사실이 DB 에 정확히 한 줄로 남았고 계상 금액이 그대로인지.
  //
  // ⚠ **서버 액션의 잠금(`계상잠김()`)은 이 테스트가 끝까지 확인하지 못한다.** Next 서버 액션은
  //   빌드마다 바뀌는 해시로 호출돼서 밖에서 직접 부를 수가 없고, 확정 뒤에는 화면에 그 액션을
  //   부르는 버튼이 아예 없기 때문이다. 여기서 보는 것은 **화면 잠금**까지다.
  //   서버 잠금은 `saveBudgetLines` · `saveContractShare` · `savePersonnelRows` ·
  //   `deleteBudgetLine` · `deletePersonnelRow` · `applyPersonnelToBudget` 여섯 곳이
  //   `계상잠김()` 을 첫 줄에서 부르는 것으로 건다 — 고칠 때 같이 확인할 것.
  const 예산행 = await pgSelect("budgets", `과제_id=eq.${과제id}&select=배정액`)
  const 합 = 예산행.reduce((s, b) => s + Number(b.배정액), 0)
  확인(합 === 총사업비, "계상 금액이 그대로다", `${합.toLocaleString("ko-KR")}원`)
  const 확정행 = await pgSelect("budget_confirmations", `과제_id=eq.${과제id}&select=동작`)
  확인(
    확정행.filter((h) => h.동작 === "확정").length === 1,
    `확정 이력이 정확히 1건 (${확정행.length}행)`,
  )

  // ⑤ 해제는 사유가 있어야 한다
  await page.evaluate(() => window.__c.누르기("확정 해제"))
  await 잠깐(400)
  확인(
    await page.evaluate(() => window.__c.버튼("해제하고 다시 계상")?.disabled === true),
    "⑤ 사유가 비면 해제 버튼이 잠겨 있다",
  )
  await page.evaluate(() => {
    const el = document.querySelector('input[placeholder*="왜 다시 여는지"]')
    window.__c.넣기(el, "e2e 검증 — 변경협약으로 총사업비가 늘었다")
  })
  await 잠깐(300)
  await page.evaluate(() => window.__c.누르기("해제하고 다시 계상"))
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    text = await 본문()
    if (text.includes("계상 진행 중")) break
  }
  확인(text.includes("계상 진행 중"), "해제하면 다시 편집할 수 있다")
  확인(text.includes("확정 이력"), "확정·해제 이력이 남는다")

  const 이력 = await pgSelect("budget_confirmations", `과제_id=eq.${과제id}&select=동작,사유`)
  확인(이력.length === 2, `이력 ${이력.length}건 (확정 1 + 해제 1)`)
  확인(
    이력.some((h) => h.동작 === "해제" && (h.사유 ?? "").includes("변경협약")),
    "해제 사유가 그대로 남았다",
  )

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
  // ⚠ id 로만 지운다. budgets·budget_confirmations 는 ON DELETE CASCADE 로 같이 사라진다.
  if (과제id != null) log(`정리: 과제 ${과제id} 삭제 ${await del("projects", `id=eq.${과제id}`)}`)
  for (const id of 양식ids) log(`정리: 양식 ${id} 삭제 ${await del("form_templates", `id=eq.${id}`)}`)
}

const 끝과제수 = (await pgSelect("projects", "select=id")).length
확인(
  끝과제수 === 시작과제수,
  `과제 수가 시작과 같다 (${시작과제수} → ${끝과제수}) — 이 테스트가 남긴 것이 없다`,
)
확인((await pgSelect("form_templates", "select=id")).length === 0, "테스트가 남긴 양식 0건")
확인((await pgSelect("budget_confirmations", "select=id")).length === 0, "테스트가 남긴 확정 이력 0건")

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
