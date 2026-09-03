// 보유 서류 판독 — 게이트웨이(127.0.0.1:3611)로 넘긴다. **여기서 claude 를 직접 부르지 않는다.**
//
// 2026-09-03 김정수 결정(scripts/lib/llm.mjs 와 같은 규칙). 그 전까지 이 파일이
// `claude -p` 를 execFile 로 직접 불렀다. 그러면 프롬프트가 파이썬과 node 두 벌이 되고,
// **시연 전에 한쪽만 고쳐지는 사고는 조용하다.**
// → 판단(프롬프트·모델·JSON 복구)은 파이썬 `bot/gongo.py` 가 갖고, 여기는 부르기만 한다.
//   프롬프트 문구는 옮길 때 **그대로** 옮겼다.
//
// 얻은 것: 모델 선택이 한 곳(`bot/extract.py` 의 RND_EXTRACT_MODEL)으로 모인다.
//          JSON 복구도 파이썬 `_json_any` 를 타므로 ```json 펜스를 견딘다.
// 잃은 것: 게이트웨이가 죽으면 판독도 못 한다. `Restart=always` 가 걸려 있고,
//          아래 함수들은 실패를 ok:false 로 돌려주므로 업로드 자체는 그대로 끝난다.
//
// 게이트웨이 상태:  systemctl status rnd-gateway  ·  journalctl -u rnd-gateway -n 50
// 라우트:  POST /document/read  ·  POST /company/read   (bot/gateway.py)

const GW = process.env.RND_GW_URL ?? "http://127.0.0.1:3611"
const TOKEN = process.env.RND_GW_TOKEN ?? ""
// 서류 판독은 파일을 Read 로 열어야 해서 공고 요약보다 오래 걸린다(실측 11~20초, 여유를 둔다).
const TIMEOUT = 330_000

async function call(path, payload) {
  try {
    const res = await fetch(GW + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 토큰이 안 걸려 있으면(루프백 신뢰) 빈 문자열이라 헤더를 안 붙인다.
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = await res.json()
    return d ?? { ok: false, error: "빈 응답" }
  } catch (e) {
    // 게이트웨이가 안 떠 있으면 여기로 온다. 업로드를 멈추지 않는다.
    return { ok: false, error: `게이트웨이 호출 실패(${GW}${path}): ${e.message}` }
  }
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

/** 0~1 사이 숫자만 확신도로 인정한다. 문자열·범위 밖은 null — 모르는 것으로 둔다. */
function 확신도(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

/**
 * 서류 한 장에서 발급일·발급기관을 읽는다. 서류함 업로드가 부른다.
 * 종류 후보를 넘겨 서류 종류도 맞춰 본다 — 사용자가 종류를 잘못 고른 채 올릴 수 있다.
 *
 * ⚠ **경로가 아니라 파일 내용을 보낸다.** rnd-gateway 는 `PrivateTmp=yes` 라 자기만의
 *   /tmp 를 보고, rnd-web 은 `PrivateTmp=no` 다 — 웹이 /tmp 에 쓴 파일을 게이트웨이가
 *   **못 읽는다.** 실측 증상이 고약했다: 모델이 "파일을 찾을 수 없습니다" 라고 문장으로
 *   답하고, 그게 JSON 이 아니어서 화면에는 JSONDecodeError 만 남았다.
 *   격리를 끄는 대신 파일을 가진 쪽이 넘긴다 — 같은 서버에 다른 스택이 돌고 있다.
 *
 * @param bytes Buffer 또는 Uint8Array. 파일을 임시로 디스크에 쓸 필요가 없다.
 * @param ext   확장자(점 없이). 게이트웨이가 그 확장자로 풀어 놓아야 claude 가 형식을 안다.
 */
export async function 서류판독(bytes, ext, 종류후보 = []) {
  const r = await call("/document/read", {
    content_b64: Buffer.from(bytes).toString("base64"),
    ext,
    candidates: 종류후보,
  })
  if (!r.ok || !r.result) {
    return { ok: false, error: r.error ?? "판독 실패", 결과: null }
  }
  const o = r.result
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

/**
 * 회사 서류 한 장에서 company_profile 항목을 읽는다.
 *
 * ⚠ 결과를 DB 에 바로 쓰지 않는다 — 부르는 쪽이 폼에만 채우고 사람이 확정한다.
 *   항목이 열 개가 넘어 하나만 틀려도 자격 판정이 뒤집힌다.
 */
export async function 회사서류판독(bytes, ext) {
  const r = await call("/company/read", {
    content_b64: Buffer.from(bytes).toString("base64"),
    ext,
  })
  if (!r.ok || !r.result) {
    return { ok: false, error: r.error ?? "판독 실패", 결과: null }
  }
  const o = { ...r.result }
  if (o.설립일) o.설립일 = 날짜정규화(o.설립일)
  o.확신도 = 확신도(o.확신도)
  return { ok: true, 결과: o }
}

/**
 * 확신도 0.70 미만은 자동 확정을 막는다.
 * **지시가 아니라 코드로 막는다** — 모델은 모호해도 단정한다(CLAUDE.md §5-3, 실측).
 */
export const 자동확정가능 = (c) => c != null && c >= 0.7
