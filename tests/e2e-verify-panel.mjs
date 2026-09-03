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
import { 로그인하고 } from "./lib/login.mjs"

const BASE = "http://127.0.0.1:3610"
/**
 * 볼 과제. 인자로 주면 그것만 보고, 안 주면 **손볼 것이 있는 과제를 찾아** 본다.
 *
 * ⚠ 예전엔 「과제 12 는 출연금이 모자란다」를 박아 뒀는데, db/111 로 출연금을 현금에 합치자
 *   그 차이가 사라져 과제 12 가 **딱 맞는 과제**가 됐다(합쳐 보니 73,625,000 으로 정확히 일치).
 *   시드의 특정 상태를 박아 두면 데이터가 좋아질 때 테스트가 빨개진다.
 *   그래서 **상태를 찾아서** 보고, 아무 데도 문제가 없으면 「손볼 것 없음」 쪽을 검사한다.
 */
const 지정과제 = process.argv[2] ? Number(process.argv[2]) : null
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

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  // 손볼 것이 있는 과제를 찾는다. 지정했으면 그것만 본다.
  let 과제 = 지정과제
  if (과제 == null) {
    await page.goto(`${BASE}/projects/all`, { waitUntil: "networkidle0", timeout: 60000 })
    await new Promise((r) => setTimeout(r, 500))
    const 후보 = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr a")]
        .map((a) => a.getAttribute("href") ?? "")
        .filter((h) => /^\/projects\/\d+$/.test(h))
        .map((h) => Number(h.split("/")[2])),
    )
    for (const id of 후보) {
      await page.goto(`${BASE}/projects/${id}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
      await new Promise((r) => setTimeout(r, 400))
      const 있나 = await page.evaluate(() => /손볼 것 \d+/.test(document.body.innerText))
      if (있나) {
        과제 = id
        break
      }
    }
    if (과제 == null) {
      // 다 맞는 상태도 **검사할 값어치가 있다** — 「손볼 것이 없습니다」를 제대로 말하는가.
      과제 = 후보[0]
      await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })
      await new Promise((r) => setTimeout(r, 600))
      const 글 = await page.evaluate(() => document.body.innerText)
      확인(글.includes("모두 맞음"), "손볼 것이 없으면 머리에 「모두 맞음」이라 적는다")
      확인(글.includes("손볼 것이 없습니다"), "무엇도 안 해도 된다고 분명히 말해 준다")
      확인(!/손볼 것 \d+/.test(글), "「손볼 것 N」 배지는 안 뜬다")
      log(`· 지금 손볼 것이 있는 과제가 없어 「다 맞음」 쪽만 검사했다 (과제 ${과제})`)
      확인(errors.length === 0, `콘솔 오류 ${errors.length}건`)
      await browser.close()
      console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
      process.exit(실패 ? 1 : 0)
    }
  }
  log(`검사할 과제: ${과제}`)
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
  // ⚠ **어떤 배지가 있는지**를 박지 않는다. 과제마다 상태가 다르고 데이터가 좋아지면 바뀐다
  //   (과제 12 는 「부족」이었다가 db/111 뒤로 다 맞음이 됐고, 지금 찾은 건 「초과」다).
  //   봐야 하는 것은 **배지가 다섯 어휘 안에 있고, 문제만 할 일에 올라오는가**다.
  const 허용 = ["부족", "초과", "확인필요", "여유", "맞음"]
  확인(
    배지들.length > 0 && 배지들.every((b) => 허용.includes(b)),
    `배지가 정해진 다섯 어휘 안에 있다 (${[...new Set(배지들)].join(" · ")})`,
  )
  const 문제배지 = 배지들.filter((b) => b === "부족" || b === "초과" || b === "확인필요")
  확인(문제배지.length > 0, `문제인 줄이 있다 (${문제배지.join(" · ")})`)
  확인(
    문제배지.length >= 패널.할일.length,
    `할 일 줄이 문제 줄보다 많지 않다 (문제 ${문제배지.length} · 할 일 ${패널.할일.length})`,
  )
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
