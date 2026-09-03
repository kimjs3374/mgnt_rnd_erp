// 개인별 인건비 — 기본 1차년도 · 연차 추가 · 엑셀 다운로드 링크
// 쓰기는 과제 13(종료 과제)에서만 한다. 과제 2(P01)는 시연 주인공이라 건드리지 않는다.
import puppeteer from "puppeteer-core"

const BASE = "http://127.0.0.1:3610"
const 과제 = 13
const log = (...a) => console.log("  ", ...a)

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
})
const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const 버튼들 = () =>
  page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()))

try {
  await page.goto(`${BASE}/projects/${과제}/budget`, { waitUntil: "networkidle0", timeout: 60000 })

  // ── 기본은 1차년도 하나뿐 ────────────────────────────────────────────────
  let 탭 = (await 버튼들()).filter((t) => t.includes("차년도"))
  log(`연차 탭: ${탭.join(", ") || "없음"}`)
  log(`${탭.length === 1 && 탭[0].startsWith("1차년도") ? "✓" : "✗"} 기본 1차년도 하나`)
  const 협약안내 = await page.evaluate(() => /협약 \d+년/.exec(document.body.innerText)?.[0] ?? null)
  log(`협약 안내: ${협약안내 ?? "없음"} (과제 13 은 2년 협약이다)`)

  // ── 연차 추가 ────────────────────────────────────────────────────────────
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "+ 연차 추가")?.click(),
  )
  await new Promise((r) => setTimeout(r, 300))
  탭 = (await 버튼들()).filter((t) => t.includes("차년도"))
  log(`추가 후 탭: ${탭.join(", ")}`)
  log(`${탭.length === 2 ? "✓" : "✗"} 2차년도가 생겼다`)

  // ── 엑셀 링크 ────────────────────────────────────────────────────────────
  const 링크 = await page.evaluate(() =>
    [...document.querySelectorAll("a")]
      .filter((a) => a.href.includes("/api/personnel/xlsx"))
      .map((a) => ({
        href: a.getAttribute("href"),
        text: a.textContent.trim(),
        꺼짐: a.className.includes("pointer-events-none"),
      })),
  )
  log(`엑셀 링크 ${링크.length}개: ${링크.map((l) => `${l.text}[${l.href}${l.꺼짐 ? " 비활성" : ""}]`).join(" · ")}`)
  log(`${링크.length === 2 ? "✓" : "✗"} 연차별 + 전체 연차`)
  log(`${링크.every((l) => l.꺼짐) ? "✓" : "△"} 인원이 없으면 비활성 (지금 0명이라 정상)`)
  log(`${링크[0]?.href?.includes(`year=2`) ? "✓" : "✗"} 고른 연차(2)가 주소에 실린다`)

  // ── 인원을 넣으면 링크가 살아나는가 ──────────────────────────────────────
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "+ 인원 추가")?.click(),
  )
  await new Promise((r) => setTimeout(r, 300))
  const 편집중꺼짐 = await page.evaluate(
    () =>
      [...document.querySelectorAll("a")].find((a) => a.href.includes("/api/personnel/xlsx"))
        ?.className.includes("pointer-events-none") ?? null,
  )
  log(`${편집중꺼짐 ? "✓" : "✗"} 저장 안 한 편집이 있으면 비활성 (파일과 DB 가 어긋나지 않게)`)

  log(errors.length ? `⚠ 콘솔 오류 ${errors.length}건: ${errors.slice(0, 2).join(" | ")}` : "✓ 콘솔 오류 없음")
} finally {
  await browser.close()
}
