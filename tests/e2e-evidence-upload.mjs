// 비목별 증빙 첨부 — 업로드 → 목록 표시 → 다운로드 주소 → 삭제까지 실제로 눌러본다.
// 렌더되는 것과 동작하는 것은 다르다. 특히 업로드는 multipart·스토리지·DB 세 곳을 지난다.
import { writeFileSync } from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 과제 = 2 // P01 = RS-2025-00410021
const log = (...a) => console.log("  ", ...a)

// 최소 PDF 한 장. 실제 증빙 파일을 테스트에 쓰지 않는다(실데이터 금지).
const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`
const 파일경로 = "/tmp/e2e-견적서-테스트.pdf"
writeFileSync(파일경로, pdf)

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

try {
  await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()
  log(`화면 ${text.length}자`)
  for (const k of ["재원 구성", "비목별 증빙 파일", "검수조서", "개인정보"]) {
    log(`  ${text.includes(k) ? "✓" : "✗"} ${k}`)
  }

  // 필수 확보 건수를 먼저 읽어 둔다. 업로드 후 하나 늘어야 한다.
  const 전 = /필수 (\d+)건 중 (\d+)건 확보/.exec(text)
  log(`업로드 전: ${전 ? `${전[2]}/${전[1]}` : "못 읽음"}`)

  // 개인정보 요건에는 input 이 없어야 한다 — 그게 이 화면의 안전장치다.
  const 입력칸 = await page.$$('input[type="file"]')
  log(`파일 입력칸 ${입력칸.length}개`)
  if (!입력칸.length) throw new Error("파일 입력칸이 없다")

  // 「필수」 요건에 올려야 확보 건수가 늘어난다. 순번 2 = 견적서(필수)이고 그게 두 번째 입력칸이다.
  await 입력칸[1].uploadFile(파일경로)
  // 서버 액션 → 스토리지 → DB → revalidate 까지 기다린다.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    text = await 본문()
    if (text.includes("e2e-견적서-테스트.pdf")) break
  }
  if (!text.includes("e2e-견적서-테스트.pdf")) throw new Error("업로드한 파일이 목록에 없다")
  log("✓ 업로드된 파일이 목록에 보인다")

  const 후 = /필수 (\d+)건 중 (\d+)건 확보/.exec(text)
  log(`업로드 후: ${후 ? `${후[2]}/${후[1]}` : "못 읽음"}`)
  // 「해당시」 요건(순번 1 견적의뢰서)에 올리면 이 숫자는 안 늘어야 한다. 필수에 올렸으니 +1 이어야 한다.
  if (전 && 후) {
    const 정상 = Number(후[2]) === Number(전[2]) + 1
    log(`${정상 ? "✓" : "⚠"} 필수 확보 ${전[2]} → ${후[2]}`)
  }

  // 업로더·업로드일시가 같은 줄에 찍히는지 — 요구사항이 그 둘의 표시였다.
  const 줄 = text.split("\n").find((l) => l.includes("e2e-견적서-테스트.pdf")) ?? ""
  log(`파일 줄: ${줄.trim()}`)
  for (const k of ["미인증", "다운로드", "삭제"]) {
    log(`  ${줄.includes(k) || text.includes(k) ? "✓" : "✗"} ${k}`)
  }

  // 다운로드 — 새 창을 열지 않고 서버 액션이 주는 서명 주소만 확인한다.
  const 다운로드결과 = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent === "다운로드")
    if (!btns.length) return "버튼 없음"
    const opened = []
    const orig = window.open
    window.open = (u) => (opened.push(u), null)
    btns[0].click()
    await new Promise((r) => setTimeout(r, 2500))
    window.open = orig
    return opened[0] ?? "열리지 않음"
  })
  log(`다운로드 주소: ${String(다운로드결과).slice(0, 90)}`)
  if (!String(다운로드결과).includes("token=")) log("⚠ 서명 주소가 아니다")

  // 정리 — 테스트가 남긴 파일을 지운다. 삭제 기능 검증도 같이 된다.
  //
  // ⚠ 여기서 사고를 냈다. 처음엔 「파일명을 포함하고 button 을 가진 div」를 찾아 그 안의
  //   첫 「삭제」를 눌렀는데, querySelectorAll("div") 는 **문서 순서라 가장 바깥 레이아웃 div**
  //   가 먼저 걸린다. 그 안의 첫 삭제 버튼은 위쪽 계상 표의 줄 삭제였고, **P01 의 인건비
  //   출연금 6,000,000 행이 지워졌다**(복구함). 조상에서 내려오지 말고 **버튼에서 올라간다.**
  await page.evaluate(async () => {
    const del = [...document.querySelectorAll("button")].find(
      (b) =>
        b.textContent === "삭제" &&
        (b.parentElement?.textContent ?? "").includes("e2e-견적서-테스트.pdf"),
    )
    del?.click()
  })
  // ⚠ 본문 텍스트로 판정하면 안 된다. 삭제 성공 메시지에 파일명이 들어가서 계속 걸린다
  //   (처음에 이걸로 「삭제되지 않았다」 오판을 냈다). **줄이 사라졌는지**를 본다.
  const 남았나 = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button")].some(
        (b) =>
          b.textContent === "다운로드" &&
          (b.parentElement?.textContent ?? "").includes("e2e-견적서-테스트.pdf"),
      ),
    )
  let 남음 = true
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    남음 = await 남았나()
    if (!남음) break
  }
  log(남음 ? "⚠ 삭제되지 않았다" : "✓ 삭제됨 (목록에서 줄이 사라졌다)")

  log(errors.length ? `⚠ 콘솔 오류 ${errors.length}건: ${errors.slice(0, 3).join(" | ")}` : "✓ 콘솔 오류 없음")
} finally {
  await browser.close()
}
