// 서류 판독 — claude -p 헤드리스. **API 키를 쓰지 않는다**(구독 로그인).
//
// 웹앱의 서버 액션(app/actions/documents.ts · company.ts)이 부른다. 배치 스크립트가
// 쓰는 scripts/lib/llm.mjs 와 프롬프트가 다르다 — 저쪽은 공고문에서 제출서류 목록을 뽑고,
// 여기는 **우리가 가진 서류 한 장에서 값을 읽는다.**
//
// ⚠ 파일을 읽혀야 하므로 `--allowed-tools "Read"` 가 반드시 있어야 한다.
//   빼면 파일을 못 읽고 **빈 응답이 is_error:false 로 돌아온다** — 성공처럼 보이는 실패다.
//   (CLAUDE.md §4 실측)
//
// ⚠ 헤드리스는 호출마다 새 세션이라 프롬프트 캐시가 안 이어진다 — 호출당 약 4만 토큰이다
//   (실측 42,735). 그래서 **파일 한 장에 한 번만** 부르고, 필요한 값을 한꺼번에 받는다.
//   항목마다 나눠 부르면 한도가 몇 배로 나간다.
import { execFile } from "node:child_process"

/**
 * 헤드리스 호출. 실패하면 ok:false 로 돌아오고 업로드는 그대로 진행된다.
 *
 * ⚠ **실패 이유를 반드시 그대로 올려보낸다.** 실패는 대개 판독 능력 문제가 아니라
 *   계정 한도다 — 실측으로 `api_error_status:429` + `result:"You've hit your session limit ·
 *   resets 11pm"` 이 돌아왔다. 이걸 「판독 실패」로 뭉개면 사람이 파서를 의심하면서
 *   시간을 버린다. 한도면 계정을 갈아타면 되는 일이다(CLAUDE.md §8 — Pro 를 비워 두는 이유).
 */
function callClaude(prompt, { timeout = 180000, allowedTools = "Read" } = {}) {
  return new Promise((resolve) => {
    execFile(
      "claude",
      [
        "-p", prompt,
        "--output-format", "json",
        "--allowed-tools", allowedTools,
        "--max-turns", "2",
        "--model", "claude-sonnet-5",
      ],
      { timeout, maxBuffer: 1024 * 1024 * 16, encoding: "utf8", cwd: "/web/rnd" },
      (err, stdout) => {
        if (err && !stdout) {
          const 시간초과 = err.killed || /ETIMEDOUT|SIGTERM/.test(err.message)
          return resolve({
            ok: false,
            error: 시간초과 ? `판독이 ${Math.round(timeout / 1000)}초를 넘겼다` : err.message,
            text: "",
          })
        }
        try {
          const d = JSON.parse(stdout)
          if (d.is_error) {
            // d.result 에 사람이 읽을 이유가 들어 있다(한도 초과·로그인 필요 등).
            const 이유 = String(d.result ?? "").trim()
            const 상태 = d.api_error_status ? ` (HTTP ${d.api_error_status})` : ""
            return resolve({
              ok: false,
              error: (이유 || "claude -p 가 오류를 돌려줬다") + 상태,
              한도초과: d.api_error_status === 429,
              text: "",
            })
          }
          // 빈 응답도 실패다. --allowed-tools "Read" 를 빼면 파일을 못 읽고
          // **빈 응답이 is_error:false 로** 돌아온다 — 성공처럼 보이는 실패다(CLAUDE.md §4).
          const text = String(d.result ?? "").trim()
          if (!text) {
            return resolve({ ok: false, error: "응답이 비어 있다(파일을 읽지 못한 것으로 보인다)", text: "" })
          }
          resolve({ ok: true, text, cost: d.total_cost_usd ?? 0 })
        } catch (e) {
          resolve({ ok: false, error: `응답 파싱 실패: ${e.message}`, text: stdout.slice(0, 500) })
        }
      },
    )
  })
}

function jsonObject(txt) {
  const m = /\{[\s\S]*\}/.exec(txt || "")
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

/** 0~1 사이 숫자만 확신도로 인정한다. 문자열·범위 밖은 null — 모르는 것으로 둔다. */
function 확신도(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

/** "2026. 6. 1." · "2026년 6월 1일" · "20260601" → "2026-06-01". 못 읽으면 null. */
export function 날짜정규화(s) {
  const t = String(s ?? "").trim()
  if (!t) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return t
  m = /(\d{4})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t.replace(/\D/g, ""))
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const 서류_프롬프트 = (path, 후보) => `파일 ${path} 를 Read 로 읽고, 아래 값을 뽑아라.

이것은 한 기업이 정부지원사업에 제출하려고 보관 중인 증빙 서류다.

규칙
- 서류에 **실제로 적혀 있는 것만** 뽑는다. 없으면 null 로 둔다. 절대 지어내지 마라.
- 발급일은 서류가 발급된 날이다. 유효기간 만료일이나 신청일이 아니다.
  「발급일」·「발행일」·「증명일」·「작성일」로 적힌 날짜를 찾아라.
- 결산연도는 재무제표류에만 있다. 없으면 null.
- 확신도는 **네가 그 값을 서류에서 실제로 봤는지**에 대한 것이다.
  흐릿하거나 여러 날짜 중 어느 것인지 애매하면 0.6 이하로 낮춰라. 추측이면 0.3 이하다.
- 근거문장은 서류에서 **그대로 인용**한다. 요약하거나 다시 쓰지 마라.
- 개인 실명·주민등록번호·연락처는 뽑지 마라. 필요 없는 값이다.

서류 종류 후보: ${후보}

JSON 객체 하나로만 답하라. 설명 금지.
{"서류종류": 위 후보 중 하나 또는 null,
 "발급일": "YYYY-MM-DD" 또는 null,
 "발급기관": 문자열 또는 null,
 "결산연도": 정수 또는 null,
 "근거문장": 서류에서 그대로 인용한 한 문장 또는 null,
 "확신도": 0~1 숫자}`

/**
 * 서류 한 장에서 발급일·발급기관을 읽는다.
 * 후보 목록을 넘겨 서류 종류도 같이 맞춰 본다 — 사용자가 종류를 잘못 고른 채 올릴 수 있다.
 */
export async function 서류판독(파일경로, 종류후보 = []) {
  const 후보 = 종류후보.length ? 종류후보.join(" · ") : "(제한 없음)"
  const r = await callClaude(서류_프롬프트(파일경로, 후보))
  if (!r.ok) return { ok: false, error: r.error ?? "판독 실패", 한도초과: !!r.한도초과, 결과: null }
  const o = jsonObject(r.text)
  if (!o) return { ok: false, error: "판독 결과를 JSON 으로 읽지 못했다", 결과: null }
  return {
    ok: true,
    결과: {
      서류종류: o.서류종류 ?? null,
      발급일: 날짜정규화(o.발급일),
      발급기관: o.발급기관 ?? null,
      결산연도: Number.isInteger(o.결산연도) ? o.결산연도 : null,
      근거문장: o.근거문장 ?? null,
      확신도: 확신도(o.확신도),
    },
  }
}

const 회사_프롬프트 = (path) => `파일 ${path} 를 Read 로 읽고, 회사 정보를 뽑아라.

사업자등록증 · 표준재무제표증명 · 기업부설연구소 인정서 · 중소기업확인서 같은
회사 서류다. 어떤 서류인지는 내용을 보고 판단해라.

규칙
- 서류에 **실제로 적혀 있는 값만** 뽑는다. 없으면 null. **절대 지어내지 마라.**
  이 값들로 정부지원사업 신청 자격을 판정한다 — 지어낸 숫자는 틀린 판정을 낳는다.
- 금액은 **원 단위 정수**로 바꿔라. "74억"이면 7400000000 이다. 단위를 착각하지 마라.
- 비율(매출증가율·부채비율·R&D집약도)은 퍼센트 숫자만. "182.3%" → 182.3
- 대표자 이름 외의 개인 실명·주민등록번호·연락처는 뽑지 마라.
- 업종코드(KSIC)는 사업자등록증에 적힌 코드가 있을 때만. 업태·종목 문구에서 추측하지 마라.
- 확신도는 값을 실제로 봤는지에 대한 것이다. 추측이면 0.3 이하로 낮춰라.

JSON 객체 하나로만 답하라. 설명 금지. 못 찾은 항목은 넣지 말고 빼라.
{"회사명": 문자열, "사업자등록번호": "000-00-00000", "대표자": 문자열,
 "소재지": 문자열, "설립일": "YYYY-MM-DD", "업종명": [문자열],
 "주요제품": 문자열, "ksic_코드": [문자열], "기업규모": "중소기업"|"중견기업"|"소상공인",
 "결산연도": 정수, "매출액": 정수(원), "매출증가율": 숫자(%), "부채비율": 숫자(%),
 "rnd_집약도": 숫자(%), "종업원수": 정수,
 "기업부설연구소": true|false, "자본전액잠식": true|false,
 "근거": {"항목명": "서류에서 그대로 인용한 문장"},
 "확신도": 0~1 숫자}`

/** 회사 서류 한 장에서 company_profile 항목을 읽는다. */
export async function 회사서류판독(파일경로) {
  const r = await callClaude(회사_프롬프트(파일경로))
  if (!r.ok) return { ok: false, error: r.error ?? "판독 실패", 한도초과: !!r.한도초과, 결과: null }
  const o = jsonObject(r.text)
  if (!o) return { ok: false, error: "판독 결과를 JSON 으로 읽지 못했다", 결과: null }
  if (o.설립일) o.설립일 = 날짜정규화(o.설립일)
  o.확신도 = 확신도(o.확신도)
  return { ok: true, 결과: o }
}

/**
 * 확신도 0.70 미만은 자동 확정을 막는다.
 * **지시가 아니라 코드로 막는다** — 모델은 모호해도 단정한다(CLAUDE.md §5-3, 실측).
 */
export const 자동확정가능 = (c) => c != null && c >= 0.7
