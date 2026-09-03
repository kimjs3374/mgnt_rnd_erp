// 단계마다 **할 수 있는 일의 탭만** 열려 있는가.
//
// 시작도 안 한 과제에 정산 탭이 있으면 그 자체가 거짓말이다(2026-09-04 사용자 지적).
//
//   | 단계 | 개요 | 연구비 계상 | 집행 | 정산 |
//   | 신청중 | ○ | ○ | ✗ | ✗ |
//   | 수행중 | ○ | ○ | ○ | ○ |
//   | 종료   | ○ | ✗ | ○ | ○ |
//
//   ① 탭이 위 표대로 뜬다
//   ② 대장 줄의 링크도 같다(신청중에 「정산」 링크가 없다)
//   ③ **주소로 직접 들어가도** 빈 표가 아니라 「왜 없는지」를 말한다
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
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 가기 = async (p) => {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(400)
}
const 본문 = () => page.evaluate(() => document.body.innerText)
/** 과제 상세의 탭 이름들. 사이드바·본문 글자와 섞이지 않게 **탭 줄만** 읽는다. */
const 탭들 = () =>
  page.evaluate(() => {
    const 이름 = ["개요", "연구비 계상", "집행", "정산"]
    const links = [...document.querySelectorAll("a")].filter((a) =>
      /^\/projects\/\d+(\/(budget|expenses|settlement))?$/.test(a.getAttribute("href") ?? ""),
    )
    return links.map((a) => a.textContent.trim()).filter((t) => 이름.includes(t))
  })

/** 그 단계의 과제 하나를 목록에서 집어 온다 — 시드 id 를 박지 않는다. */
const 첫과제 = () =>
  page.evaluate(() => {
    const a = [...document.querySelectorAll("tbody tr a")].find((x) =>
      /^\/projects\/\d+$/.test(x.getAttribute("href") ?? ""),
    )
    return a?.getAttribute("href") ?? null
  })

// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  const 기대 = {
    "/projects/applying": { 이름: "신청중", 있어야: ["개요", "연구비 계상"], 없어야: ["집행", "정산"] },
    "/projects": { 이름: "수행중", 있어야: ["개요", "연구비 계상", "집행", "정산"], 없어야: [] },
    "/projects/closed": { 이름: "사업종료", 있어야: ["개요", "집행", "정산"], 없어야: ["연구비 계상"] },
  }

  let 신청중경로 = null
  for (const [목록, e] of Object.entries(기대)) {
    await 가기(목록)
    const 경로 = await 첫과제()
    if (!경로) {
      log(`· ${e.이름}: 과제가 없어 건너뜀`)
      continue
    }
    if (e.이름 === "신청중") 신청중경로 = 경로

    // ② 대장 줄의 링크
    const 줄링크 = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")][0]
        ? [...[...document.querySelectorAll("tbody tr")][0].querySelectorAll("a")].map((a) =>
            a.getAttribute("href"),
          )
        : [],
    )
    if (e.이름 === "신청중") {
      확인(
        !줄링크.some((h) => (h ?? "").endsWith("/settlement")),
        "신청중 대장 줄에 「정산」 링크가 없다",
      )
      확인(줄링크.some((h) => (h ?? "").endsWith("/budget")), "신청중 대장 줄에 「계상」 링크는 있다")
    }
    if (e.이름 === "사업종료") {
      확인(
        !줄링크.some((h) => (h ?? "").endsWith("/budget")),
        "종료 대장 줄에 「계상」 링크가 없다",
      )
    }

    // ① 탭
    await 가기(경로)
    const 탭 = await 탭들()
    확인(
      e.있어야.every((t) => 탭.includes(t)),
      `${e.이름} 탭에 ${e.있어야.join(" · ")} 이 있다 (${탭.join(" · ")})`,
    )
    확인(
      e.없어야.every((t) => !탭.includes(t)),
      `${e.이름} 탭에 ${e.없어야.join(" · ") || "빠질 것"} 이 없다`,
    )
  }

  // ③ 주소로 직접 — 빈 표가 아니라 이유를 말한다
  if (신청중경로) {
    await 가기(`${신청중경로}/settlement`)
    확인((await 본문()).includes("아직 정산할 것이 없습니다"), "신청중 정산 주소로 들어가면 이유를 말한다")
    확인((await 본문()).includes("선정 전"), "선정 전이라고 짚어 준다")
    await 가기(`${신청중경로}/expenses`)
    확인((await 본문()).includes("아직 집행할 것이 없습니다"), "신청중 집행 주소도 마찬가지")
  } else {
    log("· 신청중 과제가 없어 ③ 은 건너뜀")
  }

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
