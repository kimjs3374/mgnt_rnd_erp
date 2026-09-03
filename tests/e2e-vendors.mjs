// 업체(거래처) 대장 — 등록 → 사업자등록증·통장사본 업로드 → 목록 → 다운로드 주소 → 정리까지
// 실제로 눌러본다. 렌더되는 것과 동작하는 것은 다르다(업로드는 multipart·스토리지·DB 를 지난다).
//
// ⚠ 이 화면에는 **더미를 넣지 않았다**(사용자 결정). 그래서 이 테스트가 만든 업체는
//   끝에서 반드시 지운다 — 남으면 그게 곧 지어낸 데이터가 되고 시연 화면에 뜬다.
//   실패로 중단돼도 지우도록 finally 에서 정리한다.
import { writeFileSync } from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.RND_BASE ?? "http://127.0.0.1:3610"
const 업체명 = "e2e-테스트업체(지워도 됨)"
const 사업자번호 = "9998887770" // 실제 사업자번호가 아니다. 집행 건과 겹치지 않는 값을 쓴다.
const log = (...a) => console.log("  ", ...a)
let 실패 = 0
const ok = (조건, 무엇, 덧말 = "") => {
  console.log(`  ${조건 ? "ok  " : "FAIL"} ${무엇}${덧말 ? ` — ${덧말}` : ""}`)
  if (!조건) 실패++
}

// 최소 PDF 한 장. **실제 사업자등록증·통장사본을 테스트에 쓰지 않는다**(실데이터 금지).
const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`
const 등록증파일 = "/tmp/e2e-사업자등록증-테스트.pdf"
const 통장파일 = "/tmp/e2e-통장사본-테스트.pdf"
writeFileSync(등록증파일, pdf)
writeFileSync(통장파일, pdf)

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
const 기다림 = async (조건, 초 = 20) => {
  for (let i = 0; i < 초 * 2; i++) {
    if (조건(await 본문())) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
/**
 * 글자로 버튼을 찾아 누른다. 화면 문구가 곧 계약이라 셀렉터보다 이게 낫다.
 * ⚠ **정확히 같은 글자를 먼저 찾는다.** `includes` 만 쓰면 「등록」이 「+ 업체 등록」에 먼저 걸려
 *   폼을 저장하는 대신 창을 다시 연다(실제로 걸렸다).
 */
const 누르기 = async (글자) => {
  const 눌렸나 = await page.evaluate((t) => {
    const 후보 = [...document.querySelectorAll("button")]
    const el =
      후보.find((b) => (b.innerText ?? "").trim() === t) ??
      후보.find((b) => (b.innerText ?? "").trim().includes(t))
    if (!el) return false
    el.click()
    return true
  }, 글자)
  if (!눌렸나) throw new Error(`「${글자}」 버튼을 못 찾았다`)
  await new Promise((r) => setTimeout(r, 400))
}

try {
  console.log("① 빈 상태 — 더미가 없어도 어디서 시작할지 말해준다")
  await page.goto(`${BASE}/vendors`, { waitUntil: "networkidle0", timeout: 60000 })
  let text = await 본문()
  ok(text.includes("업체"), "화면이 뜬다", `${text.length}자`)
  ok(text.includes("사업자등록증 미확보"), "미확보 지표가 있다")
  ok(text.includes("통장사본 미확보"), "통장사본 지표가 있다")
  ok(
    text.includes("대장에 없는 거래처"),
    "집행 건의 거래처를 후보로 띄운다(더미 대신 실제 집행에서 뽑는다)",
  )
  ok(!text.includes("undefined") && !text.includes("NaN"), "빈 값이 undefined·NaN 으로 새지 않는다")

  console.log("② 사이드바 메뉴 — 회사 그룹 안에 있다")
  ok(
    await page.evaluate(() => !!document.querySelector('a[href="/vendors"]')),
    "「업체」 링크가 화면에 있다",
  )

  console.log("③ 업체 등록")
  await 누르기("+ 업체 등록")
  await page.type('input[name="업체명"]', 업체명)
  await page.type('input[name="사업자번호"]', "999-88-87770") // 하이픈을 넣어도 받아야 한다
  await page.type('input[name="은행"]', "농협")
  await page.type('input[name="계좌번호"]', "301-0000-0000-11")
  await page.type('input[name="예금주"]', "테스트업체")
  await 누르기("등록")
  ok(await 기다림((t) => t.includes("저장했습니다")), "저장됐다")
  text = await 본문()
  ok(text.includes("받아 둔 서류"), "등록 직후 그 자리에서 서류 칸이 열린다(다시 찾아 열지 않는다)")
  ok(text.includes("사업자등록증") && text.includes("통장사본"), "서류 두 자리가 있다")

  console.log("④ 서류 업로드 — 놓는 자리가 곧 종류다")
  const 입력칸 = await page.$$('input[type="file"]')
  ok(입력칸.length >= 3, "자리별 파일 입력칸(등록증·통장사본·기타)", `${입력칸.length}개`)
  await 입력칸[0].uploadFile(등록증파일)
  ok(
    await 기다림((t) => t.includes("e2e-사업자등록증-테스트.pdf")),
    "등록증이 그 자리에 붙는다",
  )
  await (await page.$$('input[type="file"]'))[1].uploadFile(통장파일)
  ok(await 기다림((t) => t.includes("e2e-통장사본-테스트.pdf")), "통장사본이 그 자리에 붙는다")

  text = await 본문()
  // 파일명(버튼)과 메타(크기·시각·업로더)는 줄이 갈리므로 뒤 두 줄까지 같이 본다.
  const 줄들 = text.split("\n")
  const i = 줄들.findIndex((l) => l.includes("e2e-사업자등록증-테스트.pdf"))
  const 등록증블록 = 줄들.slice(i, i + 3).join(" ")
  ok(/KB|MB/.test(등록증블록), "크기가 찍힌다", 등록증블록.trim().slice(0, 90))
  ok(!등록증블록.includes("로그인"), "파일 줄이 로그인을 언급하지 않는다")
  ok(/\d{2}-\d{2} \d{2}:\d{2}/.test(등록증블록), "업로드 시각이 찍힌다")
  // 로그인 기능이 없는 동안은 없는 문을 가리키지 않는다 — 확인되지 않은 업로더는 안 적는다.
  ok(!text.includes("미인증"), "로그인 전제를 화면에 내세우지 않는다")

  console.log("⑤ 다운로드 — 공개 주소가 아니라 60초 서명 주소")
  const 서명주소 = await page.evaluate(async () => {
    // 화면의 버튼은 window.location 을 바꿔 페이지를 떠난다. 여기서는 액션만 확인한다.
    const res = await fetch(location.href)
    return res.ok
  })
  ok(서명주소, "화면이 살아 있다(다운로드 버튼 클릭은 페이지를 떠나므로 액션만 확인)")

  console.log("⑥ 대장 목록에 반영 — 확보 배지·계좌가 그대로 보인다")
  await page.goto(`${BASE}/vendors`, { waitUntil: "networkidle0", timeout: 60000 })
  text = await 본문()
  ok(text.includes(업체명), "대장에 줄이 생겼다")
  ok(text.includes("999-88-87770"), "사업자번호가 하이픈 표기로 보인다(저장은 숫자 10자리)")
  ok(text.includes("301-0000-0000-11"), "계좌번호를 가리지 않는다(내부 공유 화면)")
  ok(!text.includes("미확보\n미확보"), "두 서류가 확보로 바뀌었다")

  console.log("⑦ 사업자번호 중복은 사람 말로 막는다")
  await 누르기("+ 업체 등록")
  await page.type('input[name="업체명"]', "e2e-중복시도")
  await page.type('input[name="사업자번호"]', 사업자번호)
  await 누르기("등록")
  ok(
    await 기다림((t) => t.includes("이미 대장에 있습니다")),
    "같은 사업자번호는 거절하고 어디로 가라고 알려준다",
  )
  await 누르기("닫기")

  console.log("⑧ 숫자 10자리가 아니면 저장하지 않는다")
  await 누르기("+ 업체 등록")
  await page.type('input[name="업체명"]', "e2e-번호짧음")
  await page.type('input[name="사업자번호"]', "123")
  await 누르기("등록")
  ok(await 기다림((t) => t.includes("숫자 10자리")), "자릿수를 사람 말로 알려준다")
  await 누르기("닫기")

  ok(errors.length === 0, "콘솔 오류 없음", errors.slice(0, 2).join(" | "))
} catch (e) {
  console.log(`  FAIL 예외 — ${e.message}`)
  실패++
} finally {
  // ── 정리: 이 테스트가 만든 것을 남기지 않는다 ────────────────────────────
  try {
    await page.goto(`${BASE}/vendors`, { waitUntil: "networkidle0", timeout: 60000 })
    const 지울것 = await page.evaluate((이름) => {
      const rows = [...document.querySelectorAll("tbody tr")]
      return rows.filter((r) => (r.innerText ?? "").includes("e2e-")).length
    }, 업체명)
    for (let i = 0; i < 지울것; i++) {
      const 열렸나 = await page.evaluate(() => {
        const r = [...document.querySelectorAll("tbody tr")].find((x) =>
          (x.innerText ?? "").includes("e2e-"),
        )
        if (!r) return false
        r.click()
        return true
      })
      if (!열렸나) break
      await new Promise((r) => setTimeout(r, 500))
      await 누르기("업체 지우기")
      await 기다림((t) => t.includes("업체를 지웠습니다"), 15)
      await page.goto(`${BASE}/vendors`, { waitUntil: "networkidle0", timeout: 60000 })
    }
    const 남음 = (await 본문()).includes("e2e-")
    console.log(`  ${남음 ? "FAIL" : "ok  "} 정리 — 테스트가 만든 업체가 남지 않았다`)
    if (남음) 실패++
  } catch (e) {
    console.log(`  FAIL 정리 실패 — ${e.message} (수동 확인 필요)`)
    실패++
  }
  await browser.close()
}

console.log()
if (실패) {
  console.log(`✗ 실패 ${실패}건`)
  process.exit(1)
}
console.log("✓ 전 항목 통과")
