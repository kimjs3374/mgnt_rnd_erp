// 한도 검증 패널 — **어디가 부족하고 뭐가 문제인지 한눈에** 보이는가.
//
// 고치기 전 화면의 문제: 「✓ 간접비 10% 이내 … ₩6,000,000 미달」처럼
// **통과 표시와 「미달」이 한 줄에** 있어서, 보는 사람이 무엇이 문제인지 못 골랐다.
// 한도(상한)에서 모자란 것은 문제가 아니라 **여유**인데 일치 검사와 같은 말로 적었기 때문이다.
//
//   ① 맨 위에 「무엇을 얼마나」가 한 줄로 나온다
//   ② 상한 검사에서 모자란 것은 **여유**로 적고 문제로 세지 않는다
//   ③ 일치 검사에서 모자란 것은 **부족**으로 적고 문제로 센다
//   ④ 손봐야 하는 줄이 위로 온다
//   ⑤ 「손볼 것」 수가 실제 문제 줄 수와 맞는다 (총액은 재원과 겹쳐서 안 센다)
//
// **아무것도 바꾸지 않는다.** 읽기만 한다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 과제 = Number(process.argv[2] ?? 12) // 출연금이 모자란 시드
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}`)
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1300"],
  defaultViewport: { width: 1600, height: 1300 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

try {
  await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
  await new Promise((r) => setTimeout(r, 600))

  /** 검증 카드 안의 줄들을 배지와 함께 읽는다. */
  const 패널 = await page.evaluate(() => {
    const 카드 = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("rounded-lg") && d.textContent.trim().startsWith("한도 검증"),
    )
    if (!카드) return null
    const 목록 = [...카드.querySelectorAll("ul")]
    const 줄 = (ul) =>
      [...ul.querySelectorAll("li")].map((li) => ({
        글: li.innerText.replace(/\s+/g, " ").trim(),
        배지: li.querySelector("span")?.textContent?.trim() ?? "",
        y: li.getBoundingClientRect().top,
      }))
    return {
      머리: 카드.innerText.split("\n")[0] ?? "",
      전체: 카드.innerText,
      // 첫 ul 이 「할 일」, 그다음이 검사 목록이다(할 일이 없으면 p 로 나온다).
      할일: 목록.length > 1 ? 줄(목록[0]) : [],
      검사: 줄(목록[목록.length - 1]),
    }
  })
  if (!패널) throw new Error("한도 검증 카드를 못 찾았다")

  // ⑤ 손볼 것 개수
  const 손볼것 = /손볼 것 (\d+)/.exec(패널.전체)
  확인(!!손볼것, `머리에 「손볼 것 N」이 있다 (${손볼것?.[0] ?? "없음"})`)
  확인(패널.할일.length > 0, `할 일이 한 줄씩 적혀 있다 (${패널.할일.length}줄)`)
  확인(
    !!손볼것 && Number(손볼것[1]) === 패널.할일.length,
    `머리 숫자와 할 일 줄 수가 같다 (${손볼것?.[1]} = ${패널.할일.length})`,
  )

  // ① 「무엇을 얼마나」
  const 첫할일 = 패널.할일[0]?.글 ?? ""
  확인(/더 잡아야|덜어내야|한도를 넘|확인이 필요/.test(첫할일), `무엇을 해야 하는지 말한다: ${첫할일}`)
  확인(/[+−]₩[\d,]+/.test(첫할일), "얼마인지 부호까지 붙여 적는다")

  // ②③ 배지 종류
  const 배지들 = 패널.검사.map((r) => r.배지)
  log(`배지: ${배지들.join(" · ")}`)
  확인(배지들.includes("부족"), "일치 검사에서 모자란 줄은 「부족」")
  확인(배지들.includes("여유"), "상한 검사에서 모자란 줄은 「여유」(문제가 아니다)")
  const 여유줄 = 패널.검사.filter((r) => r.배지 === "여유")
  확인(
    여유줄.every((r) => !r.글.includes("미달")),
    "「여유」 줄에는 「미달」이라고 쓰지 않는다",
  )
  확인(
    !패널.할일.some((t) => 여유줄.some((r) => t.글.includes(r.글.split(" ")[1] ?? "@@"))),
    "여유는 할 일에 안 올라온다",
  )

  // ④ 문제 줄이 위로
  const 문제 = 패널.검사.filter((r) => r.배지 === "부족" || r.배지 === "초과")
  const 무문제 = 패널.검사.filter((r) => r.배지 === "맞음" || r.배지 === "여유")
  확인(
    문제.length > 0 &&
      무문제.length > 0 &&
      Math.max(...문제.map((r) => r.y)) < Math.min(...무문제.map((r) => r.y)),
    "손봐야 하는 줄이 위로 온다",
  )

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
