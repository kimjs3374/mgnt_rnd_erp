// 제출서류 구조화 — claude -p 헤드리스. API 키를 쓰지 않는다(구독 로그인).
// 프로토타입(gongo.py extract_documents, 2026-08-21 검증)을 그대로 이식.
import { execFileSync } from "node:child_process"

const PROMPT = `다음은 정부지원사업 공고문에서 제출서류가 언급된 구간이다.
신청자가 실제로 준비해야 할 서류만 뽑아라.

규칙
- 가점·우대사항 증빙은 별도로 분류한다(필수가 아니다).
- 평가지표표·사업비표는 서류가 아니다. 넣지 마라.
- 공고문에 없는 서류를 추측해서 만들지 마라.
- 필수/해당시 구분이 원문에서 불분명하면 "확인필요"로 표시하고 단정하지 마라.
- 발급기관이 공고문에 적혀 있을 때만 채운다. 없으면 null.

JSON 배열로만 답하라. 각 항목:
{"연번": 정수, "서류명": 문자열, "구분": "필수"|"해당시"|"가점"|"확인필요",
 "부수": 문자열|null, "발급처": 문자열|null, "비고": 문자열|null,
 "근거문장": 공고문에서 그대로 인용한 한 문장}
`

/** 헤드리스 호출. 로그인 안 돼 있으면 ok:false 로 조용히 돌아온다 — 배치를 멈추지 않는다. */
export function callClaude(stdinText, { model = "claude-sonnet-5", timeout = 600000 } = {}) {
  try {
    const stdout = execFileSync(
      "claude",
      ["-p", "위 지시대로 JSON 배열만 출력하라. 설명 금지.",
       "--output-format", "json", "--allowed-tools", "", "--max-turns", "1", "--model", model],
      { input: stdinText, timeout, maxBuffer: 1024 * 1024 * 16, encoding: "utf8" },
    )
    const d = JSON.parse(stdout)
    return {
      ok: !d.is_error,
      text: d.result ?? "",
      cost_usd: d.total_cost_usd ?? 0,
      session_id: d.session_id ?? null,
    }
  } catch (e) {
    return { ok: false, text: "", error: e.message }
  }
}

function jsonArray(txt) {
  const m = /\[[\s\S]*\]/.exec(txt || "")
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

/** sections 는 lib/extract.mjs 의 findSections() 결과. */
export function extractDocuments(sections) {
  const body = sections.map((s) => s.본문).join("\n\n---\n\n")
  const r = callClaude(PROMPT + "\n\n=== 공고문 ===\n" + body)
  return { ...r, docs: r.ok ? jsonArray(r.text) : null }
}
