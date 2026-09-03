// 과제사업 3단계 — 신청중 · 수행중 · 사업종료. **넘어가는 것**이 이 기능의 전부다.
//
//   ① 세 화면의 합이 전체와 같다(어느 단계에도 못 낀 과제가 없다)
//   ② 위쪽 단계 칩의 숫자가 실제 줄 수와 같다
//   ③ 공고에서 [지원 등록] → **신청중**에 뜬다 → [선정] → **수행중**으로 넘어가고 신청중에서 빠진다
//   ④ 수행기간이 지난 건은 저절로 **사업종료**에 있고, 저장된 상태가 안 맞으면 짚어 준다
//
// ④ 는 종료일이 지난 「상태=수행중」 행이 있어야 돈다. 없으면 그 항목만 건너뛴다
//    (셋업은 셸에서: `./db/psql.sh -c "update ..."`).
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 공고 = Number(process.argv[2] ?? 1)
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const 확인 = (ok, 말) => {
  if (!ok) 실패++
  log(`${ok ? "✓" : "✗"} ${말}`)
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1700,1200"],
  defaultViewport: { width: 1700, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const 줄수 = () => page.evaluate(() => document.querySelectorAll("tbody tr").length)
const 본문 = () => page.evaluate(() => document.body.innerText)
/** 위쪽 단계 칩이 말하는 숫자. 화면이 스스로 세는 값이라 줄 수와 맞아야 한다. */
const 칩숫자 = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('a[href^="/projects"]')]
        .map((a) => /^(신청중|수행중|사업종료)\s*(\d+)$/.exec(a.textContent.trim()))
        .filter(Boolean)
        .map((m) => [m[1], Number(m[2])]),
    ),
  )
const 가기 = async (path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 60000 })
  await 잠깐(400)
}
const 눌러 = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l)
    b?.click()
    return !!b
  }, label)

try {
  // ① · ② 단계가 갈리고 숫자가 맞는가
  const 셈 = {}
  for (const [단계, path] of [
    ["신청중", "/projects/applying"],
    ["수행중", "/projects"],
    ["사업종료", "/projects/closed"],
  ]) {
    await 가기(path)
    셈[단계] = await 줄수()
    const 칩 = await 칩숫자()
    확인(칩[단계] === 셈[단계], `${단계}: 줄 ${셈[단계]}개 · 칩 ${칩[단계]}`)
    // 세 화면 어디서든 나머지 두 단계로 바로 갈 수 있어야 한다.
    확인(Object.keys(칩).length === 3, `${단계} 화면에 단계 셋이 다 보인다`)
  }
  log(`합계: 신청중 ${셈.신청중} + 수행중 ${셈.수행중} + 사업종료 ${셈.사업종료} = ${셈.신청중 + 셈.수행중 + 셈.사업종료}`)

  // ③ 지원 등록 → 신청중 → 선정 → 수행중
  await 가기(`/announcements/${공고}`)
  const 과제명 = `E2E 단계테스트 ${Date.now().toString().slice(-6)}`
  await page.evaluate((v) => {
    const set = (el, val) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      s.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const 이름 = [...document.querySelectorAll("input")].find(
      (i) => i.type === "text" && !i.getAttribute("aria-label"),
    )
    if (이름) set(이름, v)
  }, 과제명)
  await 잠깐(200)
  await 눌러("이 공고에 지원 등록")
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    if ((await 본문()).includes("한 줄이 생겼습니다")) break
  }

  await 가기("/projects/applying")
  확인((await 줄수()) === 셈.신청중 + 1, `지원 등록이 신청중에 뜬다 (${셈.신청중} → ${await 줄수()})`)
  확인((await 본문()).includes(과제명), "그 과제가 신청중 목록에 있다")
  await 가기("/projects")
  확인(!(await 본문()).includes(과제명), "아직 수행중에는 없다")

  await 가기(`/announcements/${공고}`)
  await 눌러("선정")
  for (let i = 0; i < 30; i++) {
    await 잠깐(500)
    if ((await 본문()).includes("과제사업 대장에 뜨고")) break
  }

  await 가기("/projects")
  확인((await 본문()).includes(과제명), "선정하면 수행중으로 넘어온다")
  확인((await 줄수()) === 셈.수행중 + 1, `수행중 ${셈.수행중} → ${await 줄수()}`)
  await 가기("/projects/applying")
  확인(!(await 본문()).includes(과제명), "신청중에서는 빠진다")
  확인((await 줄수()) === 셈.신청중, `신청중 ${셈.신청중}건으로 돌아온다`)

  // ④ 수행기간이 지난 건 — 저절로 사업종료에 있고, 저장된 상태가 안 맞으면 짚어 준다
  await 가기("/projects/closed")
  const 밀림 = /상태가 아직 「수행중」인 과제가 (\d+)건/.exec(await 본문())
  if (!밀림) {
    log("· 상태가 밀린 건이 없어 ④ 는 건너뜀 (셋업하면 돈다)")
  } else {
    const 몇 = Number(밀림[1])
    확인(몇 > 0, `수행기간이 끝났는데 상태가 안 맞는 건을 짚어 준다 (${몇}건)`)
    확인(await 눌러(`${몇}건 종료로 기록`), "맞추는 버튼이 있다")
    // ⚠ 결과 문구는 **잠깐만** 보인다. 다 맞추고 나면 안내 배너 자체가 없어지고 문구도 같이 간다.
    //    그래서 「지금 보이나」가 아니라 「한 번이라도 보였나」로 잡는다.
    let 봤다 = false
    for (let i = 0; i < 30; i++) {
      await 잠깐(400)
      if ((await 본문()).includes(`${몇}건을 종료로 기록했습니다`)) {
        봤다 = true
        break
      }
      if (!/상태가 아직 「수행중」인 과제가/.test(await 본문())) break // 이미 사라졌다 = 끝난 것
    }
    확인(봤다, "몇 건을 바꿨는지 말해 준다")
    await 가기("/projects/closed")
    // 배너가 없어졌다는 것이 저장값이 실제로 바뀌었다는 증거다(서버가 다시 판정해 그린 화면이다).
    확인(!/상태가 아직 「수행중」인 과제가/.test(await 본문()), "저장된 상태가 맞춰졌다")
  }

  console.log(`\n  정리용: ./db/psql.sh -c "delete from app.projects where 과제명='${과제명}'"`)
  확인(errors.length === 0, `콘솔 오류 ${errors.length}건${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`)
} finally {
  await browser.close()
}

console.log(실패 ? `\n✗ ${실패}건 실패` : "\n✓ 전 항목 통과")
process.exit(실패 ? 1 : 0)
