// 규정 문서함 — 실제 원문이 보이는지 + 범위별로 올라가는지 + 정리까지.
//
// 이 화면의 핵심 주장은 **「규정은 사업마다 다르다」를 범위로 표현한다**는 것이다.
// 그래서 「올라간다」만 보지 않고 **어느 묶음에 들어갔는지**를 본다 —
// 폼에서 고른 범위로 가는지, 카드에 놓으면 그 카드 범위로 가는지.
//
// ⚠ 시드 4건(실제 공고·규정 원문)은 **건드리지 않는다.** 테스트가 만든 것만 지운다.
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}`)
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
  window.__t = {
    dt(names) {
      const d = new DataTransfer()
      for (const n of names) d.items.add(new File(["%PDF-1.4\\n%%EOF"], n, { type: "application/pdf" }))
      return d
    },
    보내기(el, 종류, dataTransfer) {
      el.dispatchEvent(new DragEvent(종류, { bubbles: true, cancelable: true, dataTransfer }))
    },
    // ⚠ 여기서 또 걸렸다. 「firstElementChild 의 글자가 머리글로 시작하는 div」로 찾았더니
    //   문서 순서상 **카드 목록 래퍼**가 먼저 잡혔다(래퍼의 첫 자식이 곧 카드라 글자가 같다).
    //   래퍼는 드롭 영역이 아니라서 파일이 조용히 아무 데도 안 갔다.
    //   → 증빙 정리 때 P01 예산을 날린 것과 **같은 함정**이다. 글자에서 조상으로 내려오지 말고
    //     **정확한 엘리먼트에서 closest 로 올라간다.**
    카드(머리) {
      const s = [...document.querySelectorAll("span")].find((x) => x.textContent === 머리)
      return s?.closest("div.rounded-md") ?? null
    },
    폼드롭존() {
      return [...document.querySelectorAll("div")].find((d) =>
        d.className.includes("border-dashed"),
      ) ?? null
    },
    // 버튼에서 부모로 올라가 그 줄이 내 파일인지 확인하고 누른다(조상에서 찾으면 남의 삭제가 걸린다).
    지우기(name) {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent === "삭제" && (x.parentElement?.textContent ?? "").includes(name),
      )
      b?.click()
      return !!b
    },
    남았나(name) {
      return [...document.querySelectorAll("button")].some(
        (x) => x.textContent === "다운로드" && (x.parentElement?.textContent ?? "").includes(name),
      )
    },
  }
`

const 폼파일 = ["e2e-rule-form-1.pdf", "e2e-rule-form-2.pdf"]
const 카드파일 = ["e2e-rule-common.pdf"]

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  await page.goto(`${BASE}/rules`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)
  let text = await 본문()

  확인(text.includes("규정 문서함"), "화면이 뜬다")
  for (const k of [
    "(제2026-57호) 2026년 지역혁신선도기업육성(R&D) 시행계획 공고",
    "[붙임3] (필독) 신청 방법 및 유의사항",
    "국가연구개발사업 연구개발비 사용 기준",
    "지역산업육성 기술개발사업 관리지침",
  ]) {
    확인(text.includes(k), `시드 원문이 보인다 — ${k.slice(0, 28)}…`)
  }
  확인(text.includes("p.31"), "근거메모의 쪽수가 화면에 남아 있다")
  확인(
    text.includes("공고별 규정") && text.includes("사업유형별 규정") && text.includes("공통 규정"),
    "적용 범위 세 묶음이 다 있다",
  )

  // ① 폼 드롭존 — 기본 범위(사업유형)로 들어가야 한다
  const 기본유형 = await page.evaluate(() => {
    const s = document.querySelector("select")
    return s ? s.options[s.selectedIndex].text : "(없음)"
  })
  log(`폼 기본 범위: 사업유형 · ${기본유형}`)
  const 폼결과 = await page.evaluate((names) => {
    const z = window.__t.폼드롭존()
    if (!z) return "드롭존 없음"
    window.__t.보내기(z, "dragenter", window.__t.dt(names))
    window.__t.보내기(z, "dragover", window.__t.dt(names))
    window.__t.보내기(z, "drop", window.__t.dt(names))
    return "보냄"
  }, 폼파일)
  if (폼결과 === "드롭존 없음") throw new Error("폼 드롭존을 못 찾았다")

  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    text = await 본문()
    if (폼파일.every((n) => text.includes(n))) break
  }
  확인(폼파일.every((n) => text.includes(n)), "폼에 놓은 2건이 목록에 있다")
  확인(text.includes("2건 올렸습니다"), "건수로 결과를 말해 준다")

  // 폼에서 고른 범위(사업유형)에 들어갔는지 — 「사업유형별 규정」 묶음 안에 있어야 한다
  const 묶음판정 = await page.evaluate((names) => {
    const 헤더 = [...document.querySelectorAll("span")].find(
      (s) => s.textContent === "사업유형별 규정",
    )
    const 묶음 = 헤더?.closest("div.rounded-lg")
    return names.every((n) => (묶음?.textContent ?? "").includes(n))
  }, 폼파일)
  확인(묶음판정, "폼에서 고른 범위(사업유형) 묶음 안에 들어갔다")

  // ② 공통 카드에 직접 놓기 — 놓는 자리가 범위를 정한다
  const 카드결과 = await page.evaluate((names) => {
    const c = window.__t.카드("모든 사업 공통")
    if (!c) return "카드 없음"
    window.__t.보내기(c, "dragenter", window.__t.dt(names))
    window.__t.보내기(c, "dragover", window.__t.dt(names))
    window.__t.보내기(c, "drop", window.__t.dt(names))
    return "보냄"
  }, 카드파일)
  if (카드결과 === "카드 없음") {
    확인(false, "공통 카드를 못 찾았다")
  } else {
    for (let i = 0; i < 40; i++) {
      await 잠깐(500)
      text = await 본문()
      if (카드파일.every((n) => text.includes(n))) break
    }
    확인(카드파일.every((n) => text.includes(n)), "공통 카드에 놓은 1건이 목록에 있다")
    const 공통안에 = await page.evaluate((names) => {
      const 헤더 = [...document.querySelectorAll("span")].find((s) => s.textContent === "공통 규정")
      const 묶음 = 헤더?.closest("div.rounded-lg")
      return names.every((n) => (묶음?.textContent ?? "").includes(n))
    }, 카드파일)
    확인(공통안에, "놓은 자리(공통)가 곧 적용 범위가 됐다")
  }

  // ③ 다운로드 — 서명 주소가 나오는지
  const 주소 = await page.evaluate(async (name) => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent === "다운로드" && (x.parentElement?.textContent ?? "").includes(name),
    )
    if (!b) return "버튼 없음"
    const opened = []
    const orig = window.open
    window.open = (u) => (opened.push(u), null)
    b.click()
    await new Promise((r) => setTimeout(r, 2500))
    window.open = orig
    return opened[0] ?? "열리지 않음"
  }, 폼파일[0])
  log(`다운로드 주소: ${String(주소).slice(0, 80)}`)
  확인(String(주소).includes("token="), "60초 서명 주소로 내려간다")

  // ④ 정리 — 테스트가 만든 것만 지운다. 시드 4건은 그대로 둔다.
  for (const n of [...폼파일, ...카드파일]) {
    await page.evaluate((name) => window.__t.지우기(name), n)
    for (let i = 0; i < 20; i++) {
      await 잠깐(500)
      if (!(await page.evaluate((name) => window.__t.남았나(name), n))) break
    }
  }
  const 잔여 = await page.evaluate(
    () =>
      [...document.querySelectorAll("button")].filter(
        (b) => b.textContent === "다운로드" && (b.parentElement?.textContent ?? "").includes("e2e-rule-"),
      ).length,
  )
  확인(잔여 === 0, `테스트가 남긴 파일 ${잔여}건`)

  text = await 본문()
  확인(
    text.includes("(제2026-57호) 2026년 지역혁신선도기업육성(R&D) 시행계획 공고"),
    "시드 원문은 그대로 남아 있다",
  )

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
