// 대장 [+ 기존 사업 옮겨 담기] — 실제로 눌러서 한 줄을 만들고, 만든 줄은 지운다.
//
// 이 기능에서 진짜로 봐야 할 것은 「저장된다」가 아니라 **막는 것과 말만 하는 것이 갈렸는가**다.
//   · 막는다 — 과제명·기간·총사업비 없음 · 종료일이 시작일보다 빠름 · 과제코드 중복
//   · 말만 한다 — 재원 합계가 총사업비와 다름 · 과제코드를 우리가 임시로 붙임
// 여기서 순서가 뒤집히면(경고로 막거나, 오류를 경고로 흘리면) 대장이 조용히 오염된다.
//
// ⚠ 시드 12건을 건드리지 않는다. 대장 숫자가 바뀌면 대시보드와 발표 대본이 어긋난다.
import puppeteer from "puppeteer-core"
import { env, pgSelect } from "../scripts/lib/pgrest.mjs"

/** 만든 과제 한 건을 지운다. `project_entry_log`·`budgets` 는 ON DELETE CASCADE 로 같이 사라진다. */
async function 과제삭제(id) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/projects?id=eq.${id}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Accept-Profile": "app",
      "Content-Profile": "app",
      "Content-Type": "application/json",
    },
  })
  return res.status
}

const BASE = "http://127.0.0.1:3610"
const 이름 = "e2e 옮겨담기 테스트 과제"
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
  window.__f = {
    // ⚠ React 가 쥔 입력은 el.value = x 로 바꿔도 상태가 안 따라온다.
    //    프로토타입의 네이티브 setter 로 넣고 input 이벤트를 직접 쏴야 한다.
    넣기(el, v) {
      const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v)
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }))
    },
    // label 의 첫 span 글자로 칸을 찾는다. 「과제명」과 「과제코드」가 갈리도록 startsWith 로.
    칸(라벨) {
      const l = [...document.querySelectorAll("label")].find(
        (x) => (x.querySelector("span")?.textContent ?? "").startsWith(라벨),
      )
      return l ? l.querySelector("input") ?? l.querySelector("select") : null
    },
    채우기(라벨, v) {
      const el = window.__f.칸(라벨)
      if (!el) return false
      window.__f.넣기(el, v)
      return true
    },
    버튼(글자) {
      return [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === 글자) ?? null
    },
    누르기(글자) {
      const b = window.__f.버튼(글자)
      b?.click()
      return !!b
    },
  }
`

let 만든id = null

try {
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.evaluate(심을것)
  let text = await 본문()

  const 전 = /과제 수\n(\d+)/.exec(text)
  log(`대장 과제 수(전): ${전 ? 전[1] : "못 읽음"}`)
  확인(text.includes("기존 사업 옮겨 담기"), "대장에 [기존 사업 옮겨 담기] 가 있다")

  확인(await page.evaluate(() => window.__f.누르기("+ 기존 사업 옮겨 담기")), "대화상자를 연다")
  await 잠깐(600)
  await page.evaluate(심을것)
  text = await 본문()
  확인(
    text.includes("공고 상세의 [지원 등록]"),
    "지원 등록과 성격이 다르다는 것을 대화상자가 먼저 말한다",
  )

  // ① 아무것도 안 넣으면 못 낸다
  확인(
    await page.evaluate(() => window.__f.버튼("대장에 넣기")?.disabled === true),
    "필수값이 비면 [대장에 넣기] 가 잠겨 있다",
  )

  // ② 기간을 뒤집으면 막는다
  await page.evaluate(
    (n) => {
      window.__f.채우기("과제명", n)
      window.__f.채우기("시작일", "2024-06-01")
      window.__f.채우기("종료일", "2024-01-01")
      window.__f.채우기("총사업비", "10,000,000")
    },
    이름,
  )
  await 잠깐(400)
  text = await 본문()
  확인(text.includes("종료일이 시작일보다 빠릅니다"), "기간이 뒤집히면 말해 준다")
  확인(
    await page.evaluate(() => window.__f.버튼("대장에 넣기")?.disabled === true),
    "기간이 뒤집힌 채로는 못 낸다 (막는 쪽)",
  )

  // ③ 재원 합계 불일치 — 말만 하고 막지는 않는다
  await page.evaluate(() => {
    window.__f.채우기("종료일", "2026-05-31")
    window.__f.채우기("정부지원금", "7,000,000")
  })
  await 잠깐(400)
  text = await 본문()
  확인(text.includes("재원 합계"), "재원이 안 맞으면 말해 준다")
  확인(
    await page.evaluate(() => window.__f.버튼("대장에 넣기")?.disabled === false),
    "재원이 안 맞아도 낼 수는 있다 (말만 하는 쪽)",
  )

  // ④ 저장 — 과제코드를 비워 뒀으니 임시 코드가 붙어야 하고, 그 사실을 말해야 한다
  await page.evaluate(() => window.__f.누르기("대장에 넣기"))
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    text = await 본문()
    if (text.includes("대장에 넣었습니다")) break
  }
  확인(text.includes("대장에 넣었습니다"), "저장됐다")
  확인(/MANUAL-\d{4}-\d{3}/.test(text), "과제코드가 없어 MANUAL- 임시 코드를 붙였다")
  확인(text.includes("임시로"), "임시로 붙였다는 사실을 숨기지 않는다")
  확인(text.includes("재원 합계"), "재원 불일치를 저장 뒤에도 다시 말해 준다")

  // ⑤ 대장으로 돌아가면 실제로 늘어 있어야 한다
  await page.evaluate(() => window.__f.누르기("대장으로"))
  for (let i = 0; i < 40; i++) {
    await 잠깐(500)
    text = await 본문()
    if (text.includes(이름)) break
  }
  확인(text.includes(이름), "대장 목록에 새 줄이 보인다")
  const 후 = /과제 수\n(\d+)/.exec(text)
  if (전 && 후) 확인(Number(후[1]) === Number(전[1]) + 1, `과제 수 ${전[1]} → ${후[1]}`)

  // 출처가 남았는지 — 「누가 어디서 넣었나」가 이 기능의 절반이다
  const 만든행 = await pgSelect("projects", `과제명=eq.${encodeURIComponent(이름)}&select=id`)
  만든id = 만든행[0]?.id ?? null
  확인(만든id != null, `DB 에 행이 생겼다 (id=${만든id})`)
  if (만든id != null) {
    const 로그 = await pgSelect("project_entry_log", `과제_id=eq.${만든id}&select=등록경로,등록자`)
    확인(로그[0]?.등록경로 === "수기입력", `출처가 남았다 — ${로그[0]?.등록경로} · ${로그[0]?.등록자}`)
  }

  // ⑥ 과제코드 중복은 막는다 — 시드 과제코드를 그대로 넣어 본다
  await page.evaluate(심을것)
  await page.evaluate(() => window.__f.누르기("+ 기존 사업 옮겨 담기"))
  await 잠깐(600)
  await page.evaluate(심을것)
  await page.evaluate(() => {
    window.__f.채우기("과제명", "e2e 중복코드 시도")
    window.__f.채우기("과제코드", "RS-2025-00410021")
    window.__f.채우기("시작일", "2024-01-01")
    window.__f.채우기("종료일", "2024-12-31")
    window.__f.채우기("총사업비", "1000000")
  })
  await 잠깐(400)
  await page.evaluate(() => window.__f.누르기("대장에 넣기"))
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    text = await 본문()
    if (text.includes("이미 있습니다")) break
  }
  확인(text.includes("이미 있습니다"), "중복 과제코드는 막고 이유를 말한다 (막는 쪽)")
  const 중복행 = await pgSelect("projects", `과제명=eq.${encodeURIComponent("e2e 중복코드 시도")}&select=id`)
  확인(중복행.length === 0, "막힌 건은 행이 안 생겼다")

  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`)
} finally {
  await browser.close()

  // 정리 — 만든 행을 지운다. ⚠ **id 로만 지운다.** 이름·like 로 지우면 남의 과제를 쓸어 갈 수 있다
  // (증빙 정리 때 P01 예산 한 줄을 날린 것과 같은 종류의 사고다).
  if (만든id != null) {
    console.log(`  정리: 과제 ${만든id} 삭제 ${await 과제삭제(만든id)}`)
  }
}

const 남은 = await pgSelect("projects", `과제명=eq.${encodeURIComponent(이름)}&select=id`)
확인(남은.length === 0, `테스트가 남긴 과제 ${남은.length}건`)

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
