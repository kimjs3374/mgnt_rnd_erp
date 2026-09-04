import puppeteer from "puppeteer-core"
const browser = await puppeteer.launch({headless:"new", args:["--no-sandbox"], executablePath: "/usr/bin/google-chrome"})
const page = await browser.newPage()
await page.setViewport({width:1300, height:500})
await page.goto("http://127.0.0.1:3610/announcements", {waitUntil:"networkidle2", timeout:60000})
await new Promise(r=>setTimeout(r,1000))
await page.screenshot({path:"/tmp/list2.png"})
await browser.close()
