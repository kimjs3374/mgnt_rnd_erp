// 「신청중 옆 계상 옆 중간」이 무엇인지 화면 글자 순서로 찾는다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1200 })

for (const p of ["/projects", "/projects/applying", "/project-budgeting", "/projects/2/budget"]) {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle0", timeout: 60000 })
  const t = await page.evaluate(() => document.body.innerText)
  console.log(`\n═════ ${p}`)
  console.log(t.split("\n").filter((l) => l.trim()).slice(0, 40).join("\n"))
}

// 대장 첫 줄의 칸별 글자 — 액션 칸에 무엇이 남아 있는지 본다.
await page.goto(`${BASE}/projects/applying`, { waitUntil: "networkidle0", timeout: 60000 })
const 줄 = await page.evaluate(() => {
  const 머리 = [...document.querySelectorAll("thead th")].map((t) => t.textContent.trim())
  const tr = document.querySelector("tbody tr")
  const 칸 = [...(tr?.children ?? [])].map((td) => JSON.stringify(td.textContent.trim()))
  return 머리.map((h, i) => `${i}. ${h || "(빈 머리글)"} = ${칸[i] ?? ""}`)
})
console.log("\n═════ /projects/applying 첫 줄 칸별")
console.log(줄.join("\n"))

await browser.close()
