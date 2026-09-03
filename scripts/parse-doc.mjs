/**
 * 공고·규정 원문 추출기 — HWP·HWPX 는 @rhwp/core, PDF 는 pypdf(별도)로 읽는다.
 *
 * ⚠ `getPageText` 를 쓰면 표가 통째로 사라진다(CLAUDE.md §4 실측: 심사기준표 493자 → 130,127자).
 *   반드시 `getPageTextLayout` 을 쓰고, 좌표(x·y)로 **행과 열을 계산해서** 표를 복원한다.
 *   LLM 에게 표 구조를 추측시키지 않는다.
 *
 * 쓰는 법
 *   node scripts/parse-doc.mjs <파일> [--page 3] [--grep 민간부담]
 *
 * 왜 스크립트로 남기나: 공고문이 바뀌면 다시 돌려야 하고, 「어떻게 뽑았는지」가
 * 재현 가능해야 심사의 「데이터·개방성·재현성」에 답이 된다.
 */
import { readFileSync } from "node:fs"
import init, { HwpDocument } from "@rhwp/core"

const args = process.argv.slice(2)
const file = args[0]
const pageArg = args.includes("--page") ? Number(args[args.indexOf("--page") + 1]) : null
const grep = args.includes("--grep") ? args[args.indexOf("--grep") + 1] : null
if (!file) {
  console.error("파일을 지정할 것: node scripts/parse-doc.mjs <파일> [--page N] [--grep 키워드]")
  process.exit(1)
}

// README 의 경로 방식('/rhwp_bg.wasm')은 브라우저용이다. node 에서는 바이트를 직접 넘긴다.
await init({ module_or_path: readFileSync("./node_modules/@rhwp/core/rhwp_bg.wasm") })
const doc = new HwpDocument(new Uint8Array(readFileSync(file)))
const pages = doc.pageCount()

/** 같은 줄로 볼 y 오차(px). 표 안에서 셀마다 미세하게 다르다. */
const Y_TOL = 3

function pageLines(i) {
  const { runs } = JSON.parse(doc.getPageTextLayout(i))
  const rows = []
  for (const r of runs) {
    if (!r.text || !r.text.trim()) continue
    const row = rows.find((x) => Math.abs(x.y - r.y) <= Y_TOL)
    if (row) row.items.push(r)
    else rows.push({ y: r.y, items: [r] })
  }
  rows.sort((a, b) => a.y - b.y)
  return rows.map((row) =>
    row.items
      .sort((a, b) => a.x - b.x)
      // 셀 경계는 x 간격으로만 알 수 있다. 넉넉히 벌어지면 열 구분자를 넣는다.
      .map((it, idx, arr) => {
        const prev = arr[idx - 1]
        const gap = prev ? it.x - (prev.x + (prev.w ?? 0)) : 0
        return (idx > 0 && gap > 12 ? " | " : idx > 0 ? " " : "") + it.text.trim()
      })
      .join(""),
  )
}

const from = pageArg != null ? pageArg : 0
const to = pageArg != null ? pageArg + 1 : pages
let hit = 0
for (let i = from; i < Math.min(to, pages); i++) {
  const lines = pageLines(i)
  for (const [n, line] of lines.entries()) {
    if (grep && !line.includes(grep)) continue
    hit++
    console.log(`[p${i + 1}:${n}] ${line}`)
  }
}
if (grep) console.error(`총 ${pages}쪽 · 「${grep}」 걸린 줄 ${hit}개`)
else console.error(`총 ${pages}쪽`)
