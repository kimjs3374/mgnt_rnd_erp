// 활동비 출장·회의 증빙 — 새 서류 항목이 실제로 뜨고, 정산 탭 확보 현황이 맞게 세는지.
//
//   ① 집행 탭(집행 상세 모달) — 출장 건은 출장 요건만, 회의 건은 회의 요건만 뜬다
//      (구분 필터링이 실제로 걸리는지 — 예전엔 ACTIVITY 전체 11건이 다 섞여 나왔다)
//   ② 새로 추가한 서류명(여비 지출결의서·차량운행거리·사전품의서·매출전표(영수증))이 있다
//   ③ 정산 탭 — 출장·회의 확보 현황 카드가 뜨고, 하나 올리면 확보 숫자가 늘어난다
//
// ⚠ P01(id=2)은 시연 과제고, 지금 DB 전체에 TRAVEL·MEETING 집행 건이 하나도 없다 —
//   그래서 테스트 과제 하나에 출장 건 하나, 회의 건 하나를 만들어서 확인하고 지운다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = "http://127.0.0.1:3610"
const 코드 = "E2E-TRAVEL-001"
const 이름 = "e2e 출장회의증빙 테스트 과제"

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
let 출장집행id = null
let 회의집행id = null
let 양식id = null

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

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
        총사업비: 10000000,
        상태: "수행중",
        선정결과: "선정",
      },
    ])
  )[0].id

  const 집행행 = await post("expenses", [
    {
      과제_id: 과제id,
      일자: "2026-03-10",
      거래처: "e2e 출장 거래처",
      품목: [{ 품목명: "서울 출장" }],
      공급가액: 100000,
      세액: 0,
      합계: 100000,
      비목_대분류: "ACTIVITY",
      비목_세부항목: "TRAVEL",
      재원구분: "출연금",
      상태: "확정",
    },
    {
      과제_id: 과제id,
      일자: "2026-03-11",
      거래처: "e2e 회의 거래처",
      품목: [{ 품목명: "협력사 미팅" }],
      공급가액: 50000,
      세액: 0,
      합계: 50000,
      비목_대분류: "ACTIVITY",
      비목_세부항목: "MEETING",
      재원구분: "출연금",
      상태: "확정",
    },
  ])
  출장집행id = 집행행.find((r) => r.거래처 === "e2e 출장 거래처").id
  회의집행id = 집행행.find((r) => r.거래처 === "e2e 회의 거래처").id
  log(`테스트 과제 id=${과제id} · 출장 집행 id=${출장집행id} · 회의 집행 id=${회의집행id}`)

  // ① 집행 탭에서 구분별로 요건이 갈리는지
  await page.goto(`${BASE}/projects/${과제id}/expenses`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(() => {
    window.__t = {
      열기(거래처) {
        const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(거래처))
        tr?.click()
        return !!tr
      },
    }
  })

  확인(await page.evaluate((n) => window.__t.열기(n), "e2e 출장 거래처"), "출장 건을 연다")
  await 잠깐(600)
  let 창 = await page.evaluate(() => document.querySelector('[data-slot="dialog-content"]')?.textContent ?? "")
  확인(창.includes("여비 지출결의서"), "② 여비 지출결의서가 뜬다")
  확인(창.includes("차량운행거리"), "② 차량운행거리가 뜬다")
  확인(창.includes("출장보고서") && 창.includes("출장 증빙 서류"), "이름을 고친 기존 항목도 그대로 있다")
  확인(!창.includes("회의록") && !창.includes("사전품의서"), "① 출장 건에는 회의 요건이 안 섞인다")
  const 출장요건수 = (창.match(/필수/g) ?? []).length
  log(`출장 건 배지("필수"/"해당시") 개수: ${출장요건수}`)

  await page.keyboard.press("Escape")
  await 잠깐(400)

  확인(await page.evaluate((n) => window.__t.열기(n), "e2e 회의 거래처"), "회의 건을 연다")
  await 잠깐(600)
  창 = await page.evaluate(() => document.querySelector('[data-slot="dialog-content"]')?.textContent ?? "")
  확인(창.includes("사전품의서"), "② 사전품의서가 뜬다")
  확인(창.includes("매출전표(영수증)"), "② 매출전표(영수증)가 뜬다")
  확인(창.includes("회의록"), "기존 회의록도 그대로 있다")
  확인(!창.includes("여비 지출결의서") && !창.includes("출장보고서"), "① 회의 건에는 출장 요건이 안 섞인다")

  // 서류 하나를 실제로 올려서 정산 탭 확보 숫자가 실제로 늘어나는지 본다.
  const 업로드됨 = await page.evaluate(() => {
    const li = [...document.querySelectorAll("li")].find((x) => x.textContent.includes("회의록"))
    return !!li?.querySelector('input[type="file"]')
  })
  확인(업로드됨, "회의록 줄에 첨부 입력칸이 있다")
  const inputHandle = await page.evaluateHandle(() => {
    const li = [...document.querySelectorAll("li")].find((x) => x.textContent.includes("회의록"))
    return li?.querySelector('input[type="file"]') ?? null
  })
  const fs = await import("node:fs")
  const tmp = "/tmp/e2e-회의록-테스트.pdf"
  fs.writeFileSync(tmp, "%PDF-1.4\n%%EOF")
  // ⚠ page.evaluateHandle() 은 JSHandle 을 낸다. uploadFile() 은 ElementHandle 에만 있어서
  //   asElement() 로 한 번 더 걸러야 한다 — 그냥 쓰면 "uploadFile is not a function".
  const el = inputHandle.asElement()
  if (!el) throw new Error("첨부 입력칸을 못 찾았다")
  await el.uploadFile(tmp)
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    창 = await page.evaluate(() => document.querySelector('[data-slot="dialog-content"]')?.textContent ?? "")
    if (창.includes("e2e-회의록-테스트.pdf")) break
  }
  확인(창.includes("e2e-회의록-테스트.pdf"), "회의록 파일이 올라갔다")
  const 파일행 = await pgSelect(
    "project_evidence_files",
    `과제_id=eq.${과제id}&집행_id=eq.${회의집행id}&select=id`,
  )
  양식id = 파일행[0]?.id ?? null

  // ③ 정산 탭
  await page.goto(`${BASE}/projects/${과제id}/settlement`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()
  확인(text.includes("출장·회의 증빙 확보 현황"), "정산 탭에 새 카드가 뜬다")
  확인(text.includes("0/2건 확보 완료"), "아직 둘 다 미완료 상태로 센다 (0/2)")
  확인(text.includes("e2e 출장 거래처") && text.includes("e2e 회의 거래처"), "출장·회의 두 건이 표에 있다")

  // 회의 건은 회의록 하나 올렸으니 필수 4건 중 1건 확보로 떠야 한다.
  const 회의줄 = await page.evaluate(() => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("e2e 회의 거래처"))
    return tr?.textContent ?? ""
  })
  확인(회의줄.includes("1/4"), "회의록 하나 올렸으니 회의 건은 1/4로 뜬다", 회의줄.replace(/\s+/g, " "))
  확인(
    회의줄.includes("사전품의서") && 회의줄.includes("지출결의서") && 회의줄.includes("매출전표"),
    "미확보 서류 이름이 그대로 나열된다",
  )

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
  // ⚠ id 로만 지운다. `project_evidence_files` 는 ON DELETE CASCADE 지만 **`expenses` 는 아니다**
  //   (`expenses_과제_id_fkey` 에 cascade 가 없다 — 실측 09-04, 이전 주석이 틀렸었다).
  //   과제보다 먼저 지워야 FK 위반 없이 지워진다.
  if (과제id != null) {
    // DB 행을 지우기 전에 스토리지 객체부터 지운다 — 순서를 바꾸면 storage_path 를 잃는다.
    const 남은파일 = await pgSelect(
      "project_evidence_files",
      `과제_id=eq.${과제id}&select=storage_path`,
    ).catch(() => [])
    for (const f of 남은파일) {
      if (f.storage_path) {
        await fetch(`${env.SUPABASE_URL}/storage/v1/object/evidence/${f.storage_path}`, {
          method: "DELETE",
          headers: 헤더(),
        })
      }
    }
    log(`정리: 증빙파일 ${await del("project_evidence_files", `과제_id=eq.${과제id}`)}`)
    log(`정리: 집행 ${await del("expenses", `과제_id=eq.${과제id}`)}`)
    log(`정리: 과제 ${과제id} 삭제 ${await del("projects", `id=eq.${과제id}`)}`)
  }
}

확인((await pgSelect("projects", "select=id")).length === 13, "과제 13건 (시드 + 실사용 1건, 그대로)")

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
