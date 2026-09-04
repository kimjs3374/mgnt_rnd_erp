import puppeteer from "puppeteer-core"
const browser = await puppeteer.launch({headless:"new", args:["--no-sandbox"], executablePath: "/usr/bin/google-chrome"})
const page = await browser.newPage()
await page.setViewport({width:1440, height:900})
await page.goto("https://rnd.mgnt.kr/login", {waitUntil:"networkidle2", timeout:60000})
await page.waitForSelector("#username", {timeout:20000})
await new Promise(r=>setTimeout(r,1000))
await page.type("#username", "magnatech", {delay:80})
await page.type("#password", "magna12!@", {delay:80})
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith("/login"), {timeout:20000})
await new Promise(r=>setTimeout(r,1500))

const shots = [
  ["dashboard", "https://rnd.mgnt.kr/dashboard"],
  ["explorer", "https://rnd.mgnt.kr/announcements"],
  ["detail", "https://rnd.mgnt.kr/announcements/58"],
  ["programs", "https://rnd.mgnt.kr/programs"],
  ["projects", "https://rnd.mgnt.kr/projects/all"],
]
for (const [name, url] of shots) {
  await page.goto(url, {waitUntil:"networkidle2", timeout:30000})
  await new Promise(r=>setTimeout(r,1200))
  await page.screenshot({path:`/tmp/deck_${name}.png`})
}
await browser.close()
