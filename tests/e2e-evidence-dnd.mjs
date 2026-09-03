// 비목별 증빙 첨부 — **드래그드랍**. 놓는 자리가 곧 분류라는 규칙이 실제로 지켜지는지 본다.
//
// 네 가지를 확인한다.
//   ① 서류 줄 위에 놓으면 그 요건으로 붙고, 여러 개를 한꺼번에 놓아도 다 붙는다
//   ② 파일이 떠 있는 동안 그 줄이 강조된다(어디에 놓는지 눈에 보여야 한다)
//   ③ 개인정보 서류 줄은 드롭을 **거부**한다 — 절대 규칙 5 가 화면 안내가 아니라 코드여야 한다
//   ④ 카드 밖 여백에 놓으면 조용히 삼키지 않고 어디에 놓아야 하는지 말한다
//
// ⚠ 진짜 마우스 드래그는 OS 이벤트라 puppeteer 로 못 낸다. 페이지 안에서 `DataTransfer` 에
//   File 을 담아 DragEvent 를 dispatch 한다. React 는 루트 컨테이너에서 듣기 때문에
//   `bubbles: true` 로 올려 보내면 실제 드롭과 같은 경로를 탄다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 과제 = 2 // P01 = RS-2025-00410021
const 이름들 = ["e2e-dnd-1.pdf", "e2e-dnd-2.pdf"]
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

const 본문 = () => page.evaluate(() => document.body.innerText)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

// 페이지 안에 심는 도우미. 브라우저 문맥에서만 돈다.
const 심을것 = `
  window.__dnd = {
    // 아직 파일이 안 붙은 필수 서류 줄. 비목·서류명을 박지 않는다 — 시드가 바뀌어도 살아남게.
    빈필수줄() {
      return [...document.querySelectorAll("li")].find(
        (li) =>
          li.textContent.includes("필수") &&
          !li.textContent.includes("개인정보") &&
          !li.textContent.includes("다운로드"),
      ) ?? null
    },
    개인정보줄() {
      return [...document.querySelectorAll("li")].find((li) =>
        li.textContent.includes("개인정보"),
      ) ?? null
    },
    // 최소 PDF 한 장. 실제 증빙 파일을 테스트에 쓰지 않는다(실데이터 금지).
    dt(names) {
      const d = new DataTransfer()
      for (const n of names) {
        d.items.add(new File(["%PDF-1.4\\n%%EOF"], n, { type: "application/pdf" }))
      }
      return d
    },
    보내기(el, 종류, dataTransfer) {
      el.dispatchEvent(new DragEvent(종류, { bubbles: true, cancelable: true, dataTransfer }))
    },
  }
`

try {
  await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)

  let text = await 본문()
  확인(text.includes("비목별 증빙 파일"), "증빙 패널이 떠 있다")
  확인(text.includes("끌어다 놓아도"), "드래그드랍 안내가 보인다")

  const 전 = /필수 (\d+)건 중 (\d+)건 확보/.exec(text)
  log(`드롭 전 필수 확보: ${전 ? `${전[2]}/${전[1]}` : "못 읽음"}`)

  // ② 강조 — dragenter·dragover 만 보내고 아직 놓지 않는다.
  const 강조 = await page.evaluate((names) => {
    const li = window.__dnd.빈필수줄()
    if (!li) return "줄 없음"
    li.dataset.e2e = "대상" // 아래 단계에서 같은 줄을 다시 잡으려고 표시해 둔다
    const dt = window.__dnd.dt(names)
    window.__dnd.보내기(li, "dragenter", dt)
    window.__dnd.보내기(li, "dragover", dt)
    return "보냄"
  }, 이름들)
  if (강조 === "줄 없음") throw new Error("파일 안 붙은 필수 서류 줄을 못 찾았다")
  await 잠깐(400)
  const 클래스 = await page.evaluate(
    () => document.querySelector('li[data-e2e="대상"]')?.className ?? "",
  )
  확인(클래스.includes("outline-primary"), `드래그 중 줄이 강조된다 (${클래스.trim().slice(-40)})`)

  // ① 드롭 — 두 개를 한꺼번에
  await page.evaluate((names) => {
    const li = document.querySelector('li[data-e2e="대상"]')
    window.__dnd.보내기(li, "drop", window.__dnd.dt(names))
  }, 이름들)

  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    text = await 본문()
    if (이름들.every((n) => text.includes(n))) break
  }
  확인(이름들.every((n) => text.includes(n)), "놓은 파일 2개가 모두 목록에 있다")
  확인(text.includes("2개 올렸습니다"), "여러 개를 올린 결과를 건수로 말해 준다")

  const 후 = /필수 (\d+)건 중 (\d+)건 확보/.exec(text)
  if (전 && 후) {
    확인(
      Number(후[2]) === Number(전[2]) + 1,
      `필수 확보 ${전[2]} → ${후[2]} (한 줄에 두 개를 놓아도 +1)`,
    )
  }

  // ③ 개인정보 서류 줄은 받지 않는다
  const 개인정보 = await page.evaluate((names) => {
    const li = window.__dnd.개인정보줄()
    if (!li) return "줄 없음"
    window.__dnd.보내기(li, "drop", window.__dnd.dt(names))
    return "보냄"
  }, ["e2e-dnd-막힘.pdf"])
  if (개인정보 === "줄 없음") {
    확인(false, "개인정보 서류 줄이 화면에 없다 — 안전장치를 시험할 수 없다")
  } else {
    await 잠깐(1500)
    text = await 본문()
    확인(text.includes("RCMS 에 직접 제출하세요"), "개인정보 줄에 놓으면 거부하고 이유를 말한다")
    확인(!text.includes("e2e-dnd-막힘.pdf"), "거부된 파일은 목록에 없다")
  }

  // ④ 카드 밖 여백에 놓으면
  await page.evaluate((names) => {
    const 머리 = [...document.querySelectorAll("span")].find((s) =>
      s.textContent.startsWith("비목별 증빙 파일"),
    )
    window.__dnd.보내기(머리, "drop", window.__dnd.dt(names))
  }, ["e2e-dnd-빗맞음.pdf"])
  await 잠깐(1200)
  text = await 본문()
  확인(text.includes("붙일 비목을 알 수 없습니다"), "빗맞은 드롭은 삼키지 않고 놓을 자리를 알려 준다")
  확인(!text.includes("e2e-dnd-빗맞음.pdf"), "빗맞은 파일은 올라가지 않았다")

  // 정리 — 우리가 올린 것만 지운다.
  // ⚠ 조상 div 에서 「삭제」를 찾으면 위쪽 계상 표의 줄 삭제가 먼저 걸린다(그렇게 P01 예산 한 줄을
  //   날린 적이 있다). **버튼에서 부모로 올라가** 그 줄이 우리 파일인지 확인하고 누른다.
  for (const n of 이름들) {
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
        (b) => b.textContent === "다운로드" && (b.parentElement?.textContent ?? "").includes("e2e-dnd-"),
      ).length,
  )
  확인(잔여 === 0, `테스트가 남긴 파일 ${잔여}건`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
