// 규칙엔진(bot/ann_rules.py)을 게이트웨이(127.0.0.1:3611) 너머로 부른다.
// lib/doc-ai.mjs · lib/judgment-ai.mjs 와 같은 규칙(2026-09-03 결정) — 판단은 파이썬 쪽에
// 두고 node·브라우저는 게이트웨이를 통해서만 부른다. 여기에 규칙을 적지 않는다.
//
// 라우트: POST /rules/answer (bot/gateway.py)

const GW = process.env.RND_GW_URL ?? "http://127.0.0.1:3611"
const TOKEN = process.env.RND_GW_TOKEN ?? ""
// 재판정 + 결정 동기화까지 한 번에 돈다. LLM 을 안 부르므로 보통 1초 안쪽이다.
const TIMEOUT = 30_000

async function call(path, payload) {
  try {
    const res = await fetch(GW + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = await res.json()
    return d ?? { ok: false, error: "빈 응답" }
  } catch (e) {
    return { ok: false, error: `게이트웨이 호출 실패(${GW}${path}): ${e.message}` }
  }
}

/**
 * 사람이 공고문에서 짚은 문구를 추출 규칙(app.extraction_lexicon)으로 등록하고,
 * 그 공고를 **즉시 다시 판정**해서 결과를 돌려준다.
 *
 * 짚은문구는 다음 판독부터 정규식보다 **먼저** 적용된다(bot/ann_features.scan_lexicon).
 * 즉 이 한 번의 지정이 이 공고 하나가 아니라 **같은 문구가 든 모든 공고**에 걸린다 —
 * 화면에서 그렇게 안내한다.
 */
export async function 문구짚기({ announcementId, 짚은문구, 특징키, 값, 답변자, 사유 }) {
  const r = await call("/rules/answer", {
    announcement_id: announcementId,
    특징키,
    사람_값: 값,
    답변자,
    질문: `공고문에서 「${특징키}」에 해당하는 문구를 사람이 짚었다`,
    근거문장: 짚은문구,
    짚은문구,
    종류: "게이트",
    일반화: false,
    사유: 사유 || null,
  })
  if (!r.ok) return { ok: false, error: r.error ?? "등록 실패" }
  return {
    ok: true,
    렉시콘: r.lexicon ?? null,
    판정: r.판정 ?? null,
    동기화: r.동기화 ?? null,
  }
}
