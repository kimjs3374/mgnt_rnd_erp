// 집행 **건별** 증빙 드래그드랍. 계상 탭과 같은 규칙이 이 화면에서도 지켜지는지 본다.
//
// 계상 탭(`e2e-evidence-dnd.mjs`)과 갈리는 지점이 하나 있다 —
// 여기서는 **카드 여백에 놓아도 삼키지 않고 「기타 첨부」로 붙는다.** 집행 한 건은 비목이
// 이미 정해져 있어서 붙일 곳을 못 정할 이유가 없기 때문이다(계상 탭은 비목이 여럿이라 되묻는다).
//
// 확인하는 것
//   ① 서류 줄 위에 놓으면 그 요건으로 붙고, 여러 개를 한꺼번에 놓아도 다 붙는다
//   ② 파일이 떠 있는 동안 그 줄이 강조된다
//   ③ 확보 건수가 정확히 +1 (한 줄에 두 개를 놓아도 그 줄은 한 줄이다)
//   ④ 카드 여백에 놓으면 기타로 붙되 **확보 건수는 안 늘어난다**
//
// ⚠ 진짜 마우스 드래그는 OS 이벤트라 puppeteer 로 못 낸다. 페이지 안에서 `DataTransfer` 에
//   File 을 담아 `bubbles: true` 로 DragEvent 를 dispatch 한다(React 는 루트에서 듣는다).
import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
const 과제 = 2 // P01. 첫 행이 FACILITY 라 집행단위 요건 5종이 붙는다
const 이름들 = ["e2e-exp-1.pdf", "e2e-exp-2.pdf"]
const 기타이름 = "e2e-exp-기타.pdf"
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}`)
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

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
/** 모달 안쪽만 본다. 뒤 목록의 글자가 섞이면 단정이 헐거워진다. */
const 모달 = () =>
  page.evaluate(() => document.querySelector('[data-slot="dialog-content"]')?.innerText ?? "")

const 심을것 = `
  window.__dnd = {
    상자() { return document.querySelector('[data-slot="dialog-content"]') },
    // 아직 파일이 안 붙은 필수 서류 줄. 서류명을 박지 않는다 — 이름이 바뀌어도 살아남게.
    빈필수줄() {
      const 상자 = window.__dnd.상자()
      return [...(상자?.querySelectorAll("li") ?? [])].find(
        (li) => li.textContent.includes("필수") && !li.textContent.includes("다운로드"),
      ) ?? null
    },
    머리() {
      const 상자 = window.__dnd.상자()
      return [...(상자?.querySelectorAll("span") ?? [])].find(
        (s) => s.textContent.trim() === "증빙 서류",
      ) ?? null
    },
    // 최소 PDF 한 장. 실제 증빙을 테스트에 쓰지 않는다(절대규칙 5).
    dt(names) {
      const d = new DataTransfer()
      for (const n of names) d.items.add(new File(["%PDF-1.4\\n%%EOF"], n, { type: "application/pdf" }))
      return d
    },
    보내기(el, 종류, dataTransfer) {
      el.dispatchEvent(new DragEvent(종류, { bubbles: true, cancelable: true, dataTransfer }))
    },
  }
`

const 확보읽기 = (t) => {
  const m = /(\d+)\/(\d+) 확보/.exec(t)
  return m ? { 확보: Number(m[1]), 전체: Number(m[2]) } : null
}

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  await page.goto(`${BASE}/projects/${과제}/expenses`, { waitUntil: "networkidle0", timeout: 60000 })
  const 행 = await page.$("tbody tr")
  if (!행) throw new Error("집행 행이 없다")
  await 행.click()
  await 잠깐(900)
  await page.evaluate(심을것)

  let t = await 모달()
  확인(t.includes("증빙 서류"), "집행 상세에 증빙 패널이 떠 있다")
  확인(t.includes("끌어다 놓으면"), "드래그드랍 안내가 보인다")

  const 전 = 확보읽기(t)
  log(`드롭 전 확보: ${전 ? `${전.확보}/${전.전체}` : "못 읽음"}`)

  // ② 강조 — dragenter·dragover 만 보내고 아직 놓지 않는다
  const 있나 = await page.evaluate((names) => {
    const li = window.__dnd.빈필수줄()
    if (!li) return false
    li.dataset.e2e = "대상"
    const dt = window.__dnd.dt(names)
    window.__dnd.보내기(li, "dragenter", dt)
    window.__dnd.보내기(li, "dragover", dt)
    return true
  }, 이름들)
  if (!있나) throw new Error("파일 안 붙은 필수 서류 줄을 못 찾았다")
  await 잠깐(400)
  const 클래스 = await page.evaluate(
    () => document.querySelector('li[data-e2e="대상"]')?.className ?? "",
  )
  확인(클래스.includes("outline-primary"), `드래그 중 줄이 강조된다 (${클래스.trim().slice(-38)})`)

  // ① 드롭 — 두 개를 한꺼번에
  await page.evaluate((names) => {
    window.__dnd.보내기(document.querySelector('li[data-e2e="대상"]'), "drop", window.__dnd.dt(names))
  }, 이름들)
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    t = await 모달()
    if (이름들.every((n) => t.includes(n))) break
  }
  확인(이름들.every((n) => t.includes(n)), "놓은 파일 2개가 모두 목록에 있다")
  확인(t.includes("2개 올렸습니다"), "여러 개를 올린 결과를 건수로 말해 준다")

  // ③ 확보 +1
  const 후 = 확보읽기(t)
  if (전 && 후) {
    확인(후.확보 === 전.확보 + 1, `확보 ${전.확보} → ${후.확보} (한 줄에 두 개를 놓아도 +1)`)
  } else 확인(false, "확보 건수를 못 읽었다")

  // ④ 카드 여백 — 삼키지 않고 기타로 붙는다. 요건이 아니니 확보는 그대로여야 한다.
  await page.evaluate((name) => {
    window.__dnd.보내기(window.__dnd.머리(), "drop", window.__dnd.dt([name]))
  }, 기타이름)
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    t = await 모달()
    if (t.includes(기타이름)) break
  }
  확인(t.includes(기타이름), "카드 여백에 놓으면 기타 첨부로 붙는다")
  const 끝 = 확보읽기(t)
  if (후 && 끝) 확인(끝.확보 === 후.확보, `기타로 붙은 것은 확보에 안 센다 (${끝.확보}/${끝.전체})`)

  // 정리 — 우리가 올린 것만 지운다.
  // ⚠ 조상 div 에서 「삭제」를 찾으면 엉뚱한 줄이 먼저 걸린다. **버튼에서 부모로 올라가** 확인하고 누른다.
  for (const n of [...이름들, 기타이름]) {
    await page.evaluate((name) => {
      const del = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "삭제" && (b.parentElement?.textContent ?? "").includes(name),
      )
      del?.click()
    }, n)
    for (let i = 0; i < 20; i++) {
      await 잠깐(500)
      const 남음 = await page.evaluate(
        (name) =>
          [...document.querySelectorAll("button")].some(
            (b) => b.textContent === "다운로드" && (b.parentElement?.textContent ?? "").includes(name),
          ),
        n,
      )
      if (!남음) break
    }
  }
  const 잔여 = await page.evaluate(
    () =>
      [...document.querySelectorAll("button")].filter(
        (b) => b.textContent === "다운로드" && (b.parentElement?.textContent ?? "").includes("e2e-exp-"),
      ).length,
  )
  확인(잔여 === 0, `테스트가 남긴 파일 ${잔여}건`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
