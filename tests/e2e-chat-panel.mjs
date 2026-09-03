import puppeteer from "puppeteer-core"
import { 로그인하고 } from "./lib/login.mjs"
const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--no-sandbox","--disable-gpu"], defaultViewport:{width:1440,height:900},
})
const p = await b.newPage()
const errs = []
p.on("pageerror", e => errs.push(String(e)))
// 로그인 게이트(2026-09-04) 뒤로 화면이 전부 들어갔다. 아이디·비밀번호는
// **환경변수로만** 받는다 — 저장소가 공개다(tests/lib/login.mjs).
await 로그인하고(page, BASE)

try {
  await p.goto("http://127.0.0.1:3610/dashboard", {waitUntil:"networkidle0", timeout:30000})
  await p.evaluate(() => [...document.querySelectorAll("button")].find(x=>x.textContent.includes("물어보기"))?.click())
  await new Promise(r=>setTimeout(r,600))
  await p.screenshot({path:"/tmp/shots/chat-1-open.png"})
  const suggested = await p.$$eval("aside button", bs => bs.map(x=>x.textContent.trim()).filter(t=>t.length>10))
  console.log("  추천 질문:", suggested.length, "개")
  console.log("   ", suggested[0])

  // 첫 추천 질문 클릭
  await p.evaluate(() => [...document.querySelectorAll("aside button")].find(x=>x.textContent.includes("지원사업 뭐뭐"))?.click())
  await new Promise(r=>setTimeout(r,800))
  await p.screenshot({path:"/tmp/shots/chat-2-pending.png"})
  const pendingTxt = await p.$eval("aside", e=>e.textContent)
  console.log("  대기 표시:", pendingTxt.includes("찾아보는 중") ? "있음" : "없음")

  // 답변 대기
  for (let i=0;i<40;i++){
    await new Promise(r=>setTimeout(r,2000))
    const t = await p.$eval("aside", e=>e.textContent)
    if (/\d+턴 · \d/.test(t)) break
  }
  await p.screenshot({path:"/tmp/shots/chat-3-answer.png"})
  const txt = await p.$eval("aside", e=>e.textContent)
  const m = txt.match(/(\d+)턴 · ([\d.]+)초(?: · \$([\d.]+))?/)
  console.log("  답변 도착:", m ? `${m[1]}턴 ${m[2]}초 $${m[3]??"-"}` : "⚠ 못 받음")
  console.log("  답변 길이:", txt.length, "자")
  console.log("  콘솔 오류:", errs.length ? errs.slice(0,2) : "없음")
} catch(e) {
  console.error("  실패:", e.message); await p.screenshot({path:"/tmp/shots/chat-err.png"}); process.exitCode=1
} finally { await b.close() }
