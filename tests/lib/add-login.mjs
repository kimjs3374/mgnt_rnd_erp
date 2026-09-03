// e2e 파일에 공용 로그인을 끼워 넣는다. **셸을 안 거치고 node 가 파일을 고친다** —
// 원격에서 sed 로 한글·따옴표를 다루면 조용히 깨진다(팀 메모리의 따옴표 함정).
//
//   node tests/lib/add-login.mjs tests/e2e-a.mjs tests/e2e-b.mjs …
//
// 두 곳만 바꾼다. 이미 들어 있으면 건너뛴다(여러 번 돌려도 안전).
//   ① `import puppeteer …` 다음 줄에 로그인 도우미 import
//   ② 첫 `try {` 앞에 `await 로그인하고(page, BASE)`
import { readFileSync, writeFileSync } from "node:fs"

const IMPORT = 'import { 로그인하고 } from "./lib/login.mjs"'
const CALL = "await 로그인하고(page, BASE)"

let 고침 = 0
for (const f of process.argv.slice(2)) {
  let t = readFileSync(f, "utf8")
  if (t.includes(CALL)) {
    console.log(`  · ${f} — 이미 들어 있다`)
    continue
  }

  const imp = t.match(/^import puppeteer from "puppeteer-core"$/m)
  if (!imp) {
    console.log(`  ✗ ${f} — puppeteer import 를 못 찾았다`)
    continue
  }
  t = t.replace(imp[0], `${imp[0]}\n${IMPORT}`)

  // 첫 `try {` 앞. 그 앞에 BASE 와 page 가 다 만들어져 있다.
  const i = t.indexOf("\ntry {")
  if (i < 0) {
    console.log(`  ✗ ${f} — try 블록을 못 찾았다`)
    continue
  }
  t =
    t.slice(0, i) +
    "\n// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는" +
    "\n// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).\n" +
    CALL +
    "\n" +
    t.slice(i)

  writeFileSync(f, t)
  고침++
  console.log(`  ✓ ${f}`)
}
console.log(`\n${고침}개 고쳤다`)
