// 최종 정산 서류 — 기간이 끝난 과제만 받는가, 올린 것이 목록에 뜨는가, 지우면 사라지는가.
//
// ⚠ 실제 정산 파일에는 계좌·인건비가 들어 있다(CLAUDE.md §5-5). 테스트는 최소 PDF 한 장만 쓴다.
// ⚠ 올린 파일은 끝에서 지운다 — 더미를 안 심기로 한 화면에 테스트 잔여물이 남으면 그게 지어낸 데이터다.
import { 로그인하고 } from "./lib/login.mjs"
import { writeFileSync } from "node:fs"
import puppeteer from "puppeteer-core"
import { pgSelect } from "../scripts/lib/pgrest.mjs"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const 끝난과제 = 13 // RS-2022-00284460 · 상태=종료 (2022-06-01~2024-05-31)
const 수행중과제 = 2 // P01 — 기간이 남아 있어 최종 정산을 아직 못 낸다

const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말, 곁 = "") => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}${곁 ? ` — ${곁}` : ""}`)
}

const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`
const 파일경로 = "/tmp/e2e-정산보고서-테스트.pdf"
writeFileSync(파일경로, pdf)

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1400"],
  defaultViewport: { width: 1600, height: 1400 },
})
const page = await browser.newPage()
// 게이트가 붙어 있다(2026-09-04) — 로그인하지 않으면 모든 goto 가 /login 으로 튕긴다.
await 로그인하고(page, BASE)
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
/** 최종 정산 카드 안의 파일 입력칸만 센다 — 위쪽 증빙 칸과 섞이지 않게. */
const 정산카드입력칸 = () =>
  page.evaluate(() => {
    const 카드 = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("rounded-lg") && d.textContent?.includes("최종 정산 서류"),
    )
    return 카드 ? 카드.querySelectorAll('input[type="file"]').length : -1
  })

try {
  console.log("① 기간이 남은 과제 — 카드는 있고, 왜 못 올리는지 말한다")
  await page.goto(`${BASE}/projects/${수행중과제}/settlement`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  })
  let text = await 본문()
  확인(text.includes("최종 정산 서류"), "카드가 있다(기능이 없는 것처럼 숨기지 않는다)")
  확인(
    text.includes("협약기간이 아직 끝나지 않았습니다"),
    "왜 아직 못 올리는지 적는다",
    (text.match(/협약기간이 아직[^\n]*/) ?? [""])[0].slice(0, 70),
  )
  확인((await 정산카드입력칸()) === 0, "파일 입력칸을 주지 않는다", String(await 정산카드입력칸()))

  console.log("② 기간이 끝난 과제 — 세 자리 + 기타에 올릴 수 있다")
  await page.goto(`${BASE}/projects/${끝난과제}/settlement`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  })
  text = await 본문()
  확인(text.includes("협약기간이 끝났습니다"), "기간이 끝났다고 알려준다")
  for (const k of ["정산보고서", "정산결과 통보서", "잔액 반납 증빙"]) {
    확인(text.includes(k), `「${k}」 자리가 있다`)
  }
  const 칸수 = await 정산카드입력칸()
  확인(칸수 === 4, "자리별 입력칸 4개(기본 3 + 기타)", String(칸수))
  확인(text.includes("미제출"), "아직 안 낸 자리는 「미제출」로 보인다")

  console.log("③ 제출일을 붙여 올린다")
  const 날짜칸 = await page.$('[aria-label="정산 제출일"]')
  확인(!!날짜칸, "제출일 칸이 있다")
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="정산 제출일"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(el, "2024-06-28")
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })

  const 입력칸 = await page.evaluateHandle(() => {
    const 카드 = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("rounded-lg") && d.textContent?.includes("최종 정산 서류"),
    )
    return 카드.querySelectorAll('input[type="file"]')[0] // 첫 자리 = 정산보고서
  })
  await 입력칸.asElement().uploadFile(파일경로)
  확인(
    await 기다림((t) => t.includes("e2e-정산보고서-테스트.pdf")),
    "올린 파일이 목록에 보인다",
  )
  text = await 본문()
  const 줄 = text.split("\n").find((l) => l.includes("e2e-정산보고서-테스트.pdf")) ?? ""
  const 뒤 = text.split("\n").slice(text.split("\n").indexOf(줄), text.split("\n").indexOf(줄) + 3).join(" ")
  확인(/KB|MB/.test(뒤), "크기가 찍힌다", 뒤.slice(0, 80))
  확인(뒤.includes("제출 2024-06-28"), "제출일이 파일에 붙는다")

  console.log("④ DB 에 무엇이 남았나")
  const rows = await pgSelect("settlement_documents", `과제_id=eq.${끝난과제}`)
  const 내것 = rows.filter((r) => r.파일명 === "e2e-정산보고서-테스트.pdf")
  확인(내것.length === 1, "행이 하나 생겼다", `총 ${rows.length}행`)
  확인(내것[0]?.서류종류 === "정산보고서", "놓은 자리가 서류종류가 된다", 내것[0]?.서류종류)
  확인(내것[0]?.제출일 === "2024-06-28", "제출일이 저장됐다", String(내것[0]?.제출일))
  확인(
    String(내것[0]?.storage_path ?? "").startsWith(`settlement/${끝난과제}/`),
    "경로가 과제별로 갈린다",
    내것[0]?.storage_path,
  )

  console.log("⑤ 지우면 저장소와 DB 에서 같이 사라진다")
  await page.evaluate(() => {
    const 카드 = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("rounded-lg") && d.textContent?.includes("최종 정산 서류"),
    )
    const li = [...(카드?.querySelectorAll("li") ?? [])].find((x) =>
      x.textContent?.includes("e2e-정산보고서-테스트.pdf"),
    )
    ;[...(li?.querySelectorAll("button") ?? [])]
      .find((b) => (b.innerText ?? "").trim() === "지우기")
      ?.click()
  })
  확인(await 기다림((t) => t.includes("을 지웠습니다")), "지웠다고 말한다")
  const 남음 = (await pgSelect("settlement_documents", `과제_id=eq.${끝난과제}`)).filter(
    (r) => r.파일명 === "e2e-정산보고서-테스트.pdf",
  )
  확인(남음.length === 0, "★ DB 에 남지 않는다(테스트 잔여물 0)", `${남음.length}행`)

  확인(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  ✗ 예외 — ${e.message}`)
  실패++
} finally {
  await browser.close()
}

console.log()
if (실패) {
  console.log(`✗ 실패 ${실패}건`)
  process.exit(1)
}
console.log("✓ 전 항목 통과")
