// 공고문 첨부 -> 텍스트. CLAUDE.md §3·§6 그대로: HWP·HWPX = @rhwp/core, PDF = pypdf.
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import init, { HwpDocument } from "@rhwp/core"

let rhwpReady = null
async function ensureRhwp() {
  if (!rhwpReady) {
    rhwpReady = init({
      module_or_path: readFileSync("/web/rnd/node_modules/@rhwp/core/rhwp_bg.wasm"),
    })
  }
  await rhwpReady
}

/**
 * 페이지 하나의 runs 를 읽는 순서로 복원한다. y 로 행을 묶고 x 로 정렬만 한다 —
 * 완전한 다단(2단) 레이아웃 분리는 하지 않는다(범위 밖). 표 셀 텍스트는 남는다.
 */
function reconstructPage(layout, yTol = 4) {
  const runs = layout.runs || []
  const rows = []
  for (const r of runs) {
    let row = rows.find((row) => Math.abs(row.y - r.y) <= yTol)
    if (!row) {
      row = { y: r.y, items: [] }
      rows.push(row)
    }
    row.items.push(r)
  }
  rows.sort((a, b) => a.y - b.y)
  for (const row of rows) row.items.sort((a, b) => a.x - b.x)
  return rows.map((row) => row.items.map((i) => i.text).join(" ")).join("\n")
}

async function extractHwp(path) {
  await ensureRhwp()
  const doc = new HwpDocument(new Uint8Array(readFileSync(path)))
  let text = ""
  for (let i = 0; i < doc.pageCount(); i++) {
    text += reconstructPage(JSON.parse(doc.getPageTextLayout(i))) + "\n\n"
  }
  return text
}

function extractPdf(path) {
  return execFileSync(
    "/web/rnd/scripts/.venv/bin/python",
    ["/web/rnd/scripts/pdf_extract.py", path],
    { maxBuffer: 1024 * 1024 * 64, encoding: "utf8" },
  )
}

/** 확장자로 파서를 고른다. 반환 {kind, text}. 지원 밖이면 text 는 빈 문자열. */
export async function extractText(path) {
  const ext = path.split(".").pop().toLowerCase()
  try {
    if (ext === "pdf") return { kind: "pdf", text: extractPdf(path) }
    if (ext === "hwp" || ext === "hwpx") return { kind: ext, text: await extractHwp(path) }
    return { kind: ext, text: "" }
  } catch (e) {
    return { kind: ext, text: "", error: e.message }
  }
}

// 제출서류 섹션을 여는 말들. 공고마다 표현이 다르다. (gongo.py 그대로 이식)
const SECTION_KEYS = [
  "제출서류", "제출 서류", "구비서류", "구비 서류", "신청서류",
  "신청 서류", "첨부서류", "제출자료", "서식명", "서 식 명",
]

/**
 * 제출서류로 보이는 구간을 잘라낸다. 공고문 전문을 통째로 LLM 에 넣지 않는 이유는
 * 비용이 아니라 정확도다 — 가점 증빙표·평가지표표가 같이 들어가면 오인한다.
 */
export function findSections(text, window = 2500) {
  const hits = []
  for (const k of SECTION_KEYS) {
    let idx = text.indexOf(k)
    while (idx !== -1) {
      hits.push([idx, k])
      idx = text.indexOf(k, idx + 1)
    }
  }
  hits.sort((a, b) => a[0] - b[0])
  const merged = []
  let last = -1e9
  for (const [pos, k] of hits) {
    if (pos - last < window / 2) continue
    merged.push({
      키워드: k,
      위치: pos,
      본문: text.slice(Math.max(0, pos - 200), pos + window),
    })
    last = pos
  }
  return merged
}
