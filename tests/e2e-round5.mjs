// 2026-09-03 사용자 요청 5건 검증 — 콤마 · 정산 재원 2분류 · 집행 필터 · 집행 증빙/ZIP · 개인별 인건비
//
// ⚠ 쓰기 검증은 **과제 13(종료 과제)** 에서만 한다. 과제 2(P01)는 시연 주인공이라
//   숫자가 바뀌면 데모 대본이 깨진다. 앞서 실제로 P01 예산 한 줄을 지운 사고가 있었다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const log = (...a) => console.log("  ", ...a)
const 안전과제 = 13

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
const go = (u) => page.goto(`${BASE}${u}`, { waitUntil: "networkidle0", timeout: 60000 })

try {
  // ── ① 금액 입력칸에 콤마가 붙는가 ────────────────────────────────────────
  console.log("① 금액 콤마")
  await go("/projects/2/budget")
  const 금액칸 = await page.evaluate(() =>
    [...document.querySelectorAll('input[inputmode="numeric"]')].map((i) => i.value).slice(0, 6),
  )
  log(`inputMode=numeric 칸: ${금액칸.join(" | ")}`)
  log(`${금액칸.some((v) => v.includes(",")) ? "✓" : "✗"} 콤마가 들어 있다`)

  // 실제로 쳐 본다 — 6000000 을 치면 6,000,000 으로 보여야 한다.
  const 타이핑결과 = await page.evaluate(() => {
    const el = document.querySelector('input[inputmode="numeric"]')
    if (!el) return "칸 없음"
    return el.value
  })
  const first = await page.$('input[inputmode="numeric"]')
  await first.click({ clickCount: 3 })
  await page.keyboard.type("6000000")
  const 친뒤 = await page.evaluate(
    () => document.querySelector('input[inputmode="numeric"]').value,
  )
  log(`타이핑 전 ${타이핑결과} → 6000000 입력 후 ${친뒤}`)
  log(`${친뒤 === "6,000,000" ? "✓" : "✗"} 치는 즉시 콤마`)
  await page.reload({ waitUntil: "networkidle0" }) // 저장하지 않고 되돌린다

  // ── ② 정산 원장 재원이 현금·현물뿐인가 ──────────────────────────────────
  console.log("② 정산 재원 2분류")
  await go("/projects/2/settlement")
  const 재원값 = await page.evaluate(() => {
    const 표 = document.querySelectorAll("table")[0]
    if (!표) return []
    const trs = [...표.querySelectorAll("tbody tr")]
    // 마지막 줄은 합계다(첫 칸이 colSpan=2 라 두 번째 칸이 금액이다). 재원 열이 아니라서 뺀다.
    return trs
      .slice(0, -1)
      .map((tr) => tr.children[1]?.textContent?.trim())
      .filter(Boolean)
  })
  log(`원장 재원 열: ${[...new Set(재원값)].join(", ")}`)
  log(`${재원값.every((v) => v === "현금" || v === "현물" || v === "") ? "✓" : "✗"} 현금·현물만`)
  const 원장줄 = 재원값.length
  log(`원장 ${원장줄}줄 (합치기 전 9줄이었다)`)

  // ── ③ 집행 필터 ─────────────────────────────────────────────────────────
  console.log("③ 집행 항목·기간 필터")
  await go("/projects/2/expenses")
  const 처음건수 = await page.$$eval("tbody tr", (r) => r.length)
  const sels = await page.$$("select")
  log(`필터 select ${sels.length}개 · 처음 ${처음건수}행`)
  if (sels.length >= 5) {
    // 비목 = 첫 select. 두 번째 option 을 고른다.
    const 값 = await page.evaluate(() => {
      const s = document.querySelectorAll("select")[0]
      return s.options[1]?.value ?? null
    })
    await sels[0].select(값)
    await new Promise((r) => setTimeout(r, 400))
    const 후건수 = await page.$$eval("tbody tr", (r) => r.length)
    const 요약 = await page.evaluate(() => document.body.innerText.match(/\d+건 · ₩[\d,]+/)?.[0])
    log(`비목=${값} 적용 → ${후건수}행 · 요약 "${요약}"`)
    log(`${후건수 <= 처음건수 ? "✓" : "✗"} 걸러졌다`)
    // 기간 필터도 눌러 본다 (최근 1개월 = 프리셋 두 번째)
    await page.evaluate(() => {
      const s = [...document.querySelectorAll("select")].at(-1)
      s.value = "1m"
      s.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 400))
    log(`기간 최근1개월 → ${await page.$$eval("tbody tr", (r) => r.length)}행`)
    const 해제 = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => b.textContent === "필터 해제"),
    )
    log(`${해제 ? "✓" : "✗"} 「필터 해제」 버튼이 뜬다`)
  }

  // ── ④ 집행 상세의 증빙 4종 + ZIP ────────────────────────────────────────
  console.log("④ 집행 증빙 · ZIP")
  await go("/projects/2/expenses")
  const 행 = await page.$("tbody tr")
  if (행) {
    await 행.click()
    await new Promise((r) => setTimeout(r, 800))
    const 모달 = await page.evaluate(
      () => document.querySelector('[data-slot="dialog-content"]')?.innerText ?? "",
    )
    for (const k of ["증빙 서류", "견적서", "지출결의서", "거래명세서", "검수조서"]) {
      log(`  ${모달.includes(k) ? "✓" : "✗"} ${k}`)
    }
    const zip = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-slot="dialog-content"] a')].find((a) =>
          a.href.includes("/api/evidence/zip"),
        )?.href ?? null,
    )
    log(`ZIP 링크: ${zip ?? "없음(첨부 0건이면 정상)"}`)
    await page.keyboard.press("Escape")
  }

  // ── ⑤ 개인별 인건비 — 과제 13 에서만 쓴다 ───────────────────────────────
  console.log(`⑤ 개인별 인건비 (과제 ${안전과제})`)
  await go(`/projects/${안전과제}/budget`)
  let 본문 = await page.evaluate(() => document.body.innerText)
  log(`${본문.includes("개인별 인건비") ? "✓" : "✗"} 카드가 있다`)
  log(`${본문.includes("차년도") ? "✓" : "✗"} 연차 탭`)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "+ 인원 추가")
    b?.click()
  })
  await new Promise((r) => setTimeout(r, 300))

  // 표시명·월급여·참여율·개월 채우기 (가명만 쓴다 — 실명·실급여 금지)
  await page.evaluate(() => {
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set
      setter.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const 이름칸 = [...document.querySelectorAll('input[aria-label="표시명"]')].at(-1)
    set(이름칸, "테스트연구원Z")
    set([...document.querySelectorAll('input[aria-label="월급여"]')].at(-1), "4000000")
    set([...document.querySelectorAll('input[aria-label="참여율"]')].at(-1), "25")
    set([...document.querySelectorAll('input[aria-label="참여개월수"]')].at(-1), "6")
  })
  await new Promise((r) => setTimeout(r, 300))
  본문 = await page.evaluate(() => document.body.innerText)
  log(`${본문.includes("6,000,000") ? "✓" : "✗"} 총액 6,000,000 자동 계산 (4,000,000 × 25% × 6)`)
  log(`${본문.includes("48,000,000") ? "✓" : "✗"} 급여총액 48,000,000 (× 12)`)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "인건비 저장")
    b?.click()
  })
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    본문 = await page.evaluate(() => document.body.innerText)
    if (본문.includes("저장했습니다")) break
  }
  log(`${본문.includes("저장했습니다") ? "✓" : "✗"} 저장`)

  // ⚠ 「인건비 비목으로 반영」은 budgets 를 덮어쓴다. 기본으로는 누르지 않는다 —
  //   테스트가 시드 금액을 조용히 바꿔 놓으면 다음 사람이 원인을 못 찾는다(실제로 겪었다).
  //   확인하려면 `node tests/e2e-round5.mjs --apply` 로 돌리고, 끝에 찍히는 복구 SQL 을 실행한다.
  const 반영버튼있음 = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((x) => x.textContent === "인건비 비목으로 반영"),
  )
  log(`${반영버튼있음 ? "✓" : "✗"} 「인건비 비목으로 반영」 버튼`)

  if (process.argv.includes("--apply")) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent === "인건비 비목으로 반영",
      )
      b?.click()
    })
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500))
      본문 = await page.evaluate(() => document.body.innerText)
      if (본문.includes("반영했습니다")) break
    }
    const 반영줄 = 본문.split("\n").find((l) => l.includes("반영했습니다")) ?? ""
    log(`${반영줄 ? "✓" : "✗"} 반영: ${반영줄.trim()}`)
    console.log(
      `\n  ⚠ 과제 ${안전과제} 의 인건비 배정액이 바뀌었다. 아래로 되돌릴 것:\n` +
        `  ./db/psql.sh -c "update app.budgets set 배정액=13500000 where 과제_id=13 and 비목_대분류='PERSONNEL' and 재원구분='현물'"\n`,
    )
  } else {
    log("… 반영 클릭은 건너뜀 (--apply 로 실행하면 눌러 본다)")
  }

  // 테스트가 만든 인원 줄은 지운다.
  await page.evaluate(() => {
    const 이름칸 = [...document.querySelectorAll('input[aria-label="표시명"]')].find(
      (i) => i.value === "테스트연구원Z",
    )
    const tr = 이름칸?.closest("tr")
    const del = [...(tr?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "삭제")
    del?.click()
  })
  await new Promise((r) => setTimeout(r, 1200))
  본문 = await page.evaluate(() => document.body.innerText)
  log(`${본문.includes("테스트연구원Z") ? "⚠ 테스트 인원이 남았다" : "✓ 테스트 인원 정리됨"}`)

  log(errors.length ? `⚠ 콘솔 오류 ${errors.length}건: ${errors.slice(0, 2).join(" | ")}` : "✓ 콘솔 오류 없음")
} finally {
  await browser.close()
}
