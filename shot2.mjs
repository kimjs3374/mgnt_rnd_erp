import puppeteer from "puppeteer"
const browser = await puppeteer.launch({headless:"new", args:["--no-sandbox"]})
const page = await browser.newPage()
await page.setViewport({width:1200, height:500})
await page.goto("http://127.0.0.1:3610/announcements", {waitUntil:"networkidle2", timeout:60000})
await new Promise(r=>setTimeout(r,1500))
await page.screenshot({path:"/tmp/check2.png"})
await browser.close()
