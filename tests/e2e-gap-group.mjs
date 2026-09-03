// 증빙 미비 목록에서 **과제끼리 눈으로 갈라지는가.** (2026-09-04 사용자 지시)
//
//   ① 과제 블록마다 왼쪽 굵은 띠가 있고 **붙어 있는 두 블록의 색이 다르다**
//   ② 색만으로 가르지 않는다 — 순번(1/2)과 머리 배경도 같이 있다
//   ③ 줄을 누르면 그 집행 건으로 간다(기존 동작이 안 깨졌는지)
//
// 읽기만 한다. 아무것도 안 바꾼다.
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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1300"],
  defaultViewport: { width: 1700, height: 1300 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

await 로그인하고(page, BASE)
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(700)

  // 카드를 눌러 목록을 연다
  const 열렸나 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.getAttribute("aria-label") ?? "").startsWith("사업비 증빙 미비"),
    )
    b?.click()
    return !!b
  })
  확인(열렸나, "증빙 미비 카드를 눌러 목록을 연다")
  await 잠깐(800)

  const 블록 = await page.evaluate(() => {
    const 상자 = document.querySelector('[data-slot="dialog-content"]')
    if (!상자) return null
    // 과제 블록 = 왼쪽 띠(border-l-4)를 가진 div
    const 들 = [...상자.querySelectorAll("div")].filter((d) => d.className.includes("border-l-4"))
    return 들.map((d) => {
      const cs = getComputedStyle(d)
      return {
        띠색: cs.borderLeftColor,
        띠굵기: cs.borderLeftWidth,
        글: d.innerText.split("\n")[0]?.trim() ?? "",
        순번: /(\d+)\/(\d+)/.exec(d.innerText)?.[0] ?? "",
        머리배경: (() => {
          const h = d.querySelector("div")
          return h ? getComputedStyle(h).backgroundColor : ""
        })(),
      }
    })
  })
  확인(!!블록 && 블록.length >= 2, `과제 블록이 둘 이상이다 (${블록?.length ?? 0}개)`)
  if (블록 && 블록.length >= 2) {
    log(`띠색: ${블록.map((b) => b.띠색).join(" · ")}`)

    // ①
    확인(
      블록.every((b) => parseFloat(b.띠굵기) >= 3),
      `띠가 굵다 (${블록[0].띠굵기})`,
    )
    const 이웃다름 = 블록.every((b, i) => i === 0 || b.띠색 !== 블록[i - 1].띠색)
    확인(이웃다름, "붙어 있는 두 블록의 띠 색이 다르다")
    확인(
      new Set(블록.map((b) => b.띠색)).size >= Math.min(블록.length, 5),
      `색이 과제마다 돌아간다 (${new Set(블록.map((b) => b.띠색)).size}종)`,
    )

    // ② 색 말고도 갈라지는 단서
    확인(
      블록.every((b) => /^\d+\/\d+$/.test(b.순번)),
      `순번이 붙어 있다 (${블록.map((b) => b.순번).join(" · ")}) — 색을 못 봐도 갈라진다`,
    )
    const 배경있음 = 블록.every(
      (b) => b.머리배경 && b.머리배경 !== "rgba(0, 0, 0, 0)" && b.머리배경 !== "transparent",
    )
    확인(배경있음, "과제 머리에 배경색이 깔린다")
  }

  // ②-2 **열이 실제로 맞는가.** 이 화면의 요점은 「여러 줄을 세로로 훑는다」이다.
  //     폭이 고정돼 있지 않으면 거래처 이름 길이에 따라 금액이 밀린다 — 눈으로 말고 좌표로 본다.
  const 정렬 = await page.evaluate(() => {
    const 상자 = document.querySelector('[data-slot="dialog-content"]')
    const 줄들 = [...(상자?.querySelectorAll("li") ?? [])]
      .map((li) => li.firstElementChild)
      .filter((d) => d && d.children.length >= 6)
    const 자리 = (i) => 줄들.map((d) => Math.round(d.children[i].getBoundingClientRect().right))
    return { 줄수: 줄들.length, 금액오른쪽: 자리(2), 확보오른쪽: 자리(4) }
  })
  if (정렬.줄수 < 2) {
    log("· 한 과제에 줄이 " + 정렬.줄수 + "개뿐이라 정렬 비교는 건너뛴다")
  } else {
    확인(
      new Set(정렬.금액오른쪽).size === 1,
      "금액이 세로로 맞는다 (오른쪽 끝 " + [...new Set(정렬.금액오른쪽)].join(" · ") + ")",
    )
    확인(
      new Set(정렬.확보오른쪽).size === 1,
      "확보수가 세로로 맞는다 (" + [...new Set(정렬.확보오른쪽)].join(" · ") + ")",
    )
  }
  const 상자글 = await page.evaluate(
    () => document.querySelector('[data-slot="dialog-content"]')?.innerText ?? "",
  )
  확인(상자글.includes("확보"), "「확보」 열 머리말이 있다 — 0/4 가 무슨 수인지 말해 준다")
  확인(
    !상자글.includes("빠진 서류"),
    "「빠진 서류 N장」을 안 적는다 — 들어가면 그 화면이 말해 준다(사용자 지시)",
  )

  // ③ 기존 동작
  const 링크 = await page.evaluate(() => {
    const 상자 = document.querySelector('[data-slot="dialog-content"]')
    return [...(상자?.querySelectorAll("a") ?? [])]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.includes("?expense="))
  })
  확인(링크.length > 0, `「채우러 가기」가 그 집행 건으로 간다 (${링크[0] ?? "없음"})`)

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
