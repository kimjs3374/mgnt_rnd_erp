/**
 * e2e 공용 로그인. **2026-09-04 로그인 게이트가 붙으면서 모든 e2e 가 막혔다** —
 * `middleware.ts` 가 `/login` · `/api/*` 말고 전부 `/login?next=…` 로 돌린다.
 * 테스트마다 로그인 절차를 다시 짜면 화면이 바뀔 때 여러 곳을 고치게 되므로 한 벌만 둔다.
 *
 * ⚠⚠ **아이디·비밀번호를 이 파일에 적지 않는다.** 저장소가 공개다(CLAUDE.md §2 · §5 절대규칙 5).
 *    환경변수로만 받는다:
 *
 *      RND_TEST_ID=<아이디> RND_TEST_PW=<비밀번호> node tests/e2e-무엇.mjs
 *
 *    셸에 한 번 넣어 두고 쓰는 편이 편하다(히스토리에 남는 것은 각자 관리):
 *      export RND_TEST_ID=... RND_TEST_PW=...
 *
 *    ⚠ 값을 `_팀로그`·발표자료·스크린샷에도 옮겨 적지 않는다. 팀 규칙이 「문서에 비번을 적지 않는다」다.
 */

export const 로그인정보 = () => ({
  id: process.env.RND_TEST_ID ?? "",
  pw: process.env.RND_TEST_PW ?? "",
})

/**
 * 로그인하고 목적지까지 간다. 이미 로그인돼 있으면 그냥 간다.
 *
 * 반환값은 없다 — 실패하면 **던진다.** 로그인이 안 된 채로 테스트를 이어가면
 * 「화면에 아무것도 없다」는 엉뚱한 실패가 줄줄이 나서 원인을 못 찾는다.
 */
export async function 로그인하고(page, BASE, 목적지 = "/dashboard") {
  const { id, pw } = 로그인정보()
  if (!id || !pw) {
    throw new Error(
      "로그인 정보가 없다. RND_TEST_ID · RND_TEST_PW 환경변수를 주고 실행할 것 " +
        "(비밀번호는 코드·저장소에 적지 않는다).",
    )
  }

  await page.goto(`${BASE}${목적지}`, { waitUntil: "networkidle0", timeout: 60000 })
  // 게이트를 안 만났으면 이미 로그인된 상태다.
  if (!page.url().includes("/login")) return

  await page.waitForSelector("#username", { timeout: 20000 })
  await page.evaluate(
    ({ id, pw }) => {
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
        s.call(el, v)
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
      set(document.querySelector("#username"), id)
      set(document.querySelector("#password"), pw)
    },
    { id, pw },
  )

  // ⚠ 글자로 버튼을 찾으면 **「로그인」 탭 버튼**이 먼저 잡힌다(화면에 로그인/계정 신청 탭이 있다).
  //   아이디 칸이 들어 있는 **그 폼의 submit 버튼**을 집는다.
  const 눌렀나 = await page.evaluate(() => {
    const form = document.querySelector("#username")?.closest("form")
    const b = form?.querySelector('button[type="submit"]') ?? form?.querySelector("button")
    b?.click()
    return !!b
  })
  if (!눌렀나) throw new Error("로그인 폼의 제출 버튼을 못 찾았다")

  // 서버 액션이라 폼 제출 뒤 리다이렉트가 한 박자 늦게 온다. 주소가 바뀔 때까지 본다.
  for (let i = 0; i < 30; i++) {
    if (!page.url().includes("/login")) break
    await new Promise((r) => setTimeout(r, 400))
  }
  if (page.url().includes("/login")) {
    const 오류 = await page.evaluate(() => document.body.innerText.slice(0, 200))
    throw new Error(`로그인 실패 — 아직 /login 이다. 화면: ${오류.replace(/\s+/g, " ")}`)
  }

  // 목적지가 로그인 뒤 기본 화면과 다르면 한 번 더 간다.
  if (목적지 && !page.url().endsWith(목적지)) {
    await page.goto(`${BASE}${목적지}`, { waitUntil: "networkidle0", timeout: 60000 })
  }
}
