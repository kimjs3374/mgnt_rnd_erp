// 사람의 판정+코멘트를 의미 학습(judgment_semantic)에 넘긴다 — 게이트웨이(127.0.0.1:3611)로.
// **여기서 임베딩 모델을 직접 부르지 않는다.** lib/doc-ai.mjs·scripts/lib/llm.mjs 와
// 같은 규칙(2026-09-03 결정) — 무거운 판단은 파이썬 쪽(bot/semantic_learn.py)에 두고
// node·브라우저는 게이트웨이를 통해서만 부른다.
//
// extraction_lexicon(문자열 그대로 일치, app/actions/eligibility.ts 가 아직 안 씀)과
// 다른 층이다 — 이건 뜻이 비슷하면 걸린다(코사인 유사도, bot/semantic_learn.py).
//
// 라우트: POST /judgment/record · POST /judgment/similar (bot/gateway.py)

const GW = process.env.RND_GW_URL ?? "http://127.0.0.1:3611"
const TOKEN = process.env.RND_GW_TOKEN ?? ""
// 임베딩 모델을 디스크에서 새로 올려야 할 때가 있다(격리된 venv, 모델 캐시는 있지만
// 프로세스는 매번 새로 뜬다) — 문서 판독(lib/doc-ai.mjs)만큼 넉넉히 둔다.
const TIMEOUT = 60_000

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
 * 판정+코멘트를 임베딩해서 쌓는다. text 는 판정의 **근거가 된 문장**이어야 한다
 * (판정 결과 자체가 아니라 왜 그런지를 말하는 문장 — 다음에 비슷한 문장이 나왔을 때
 * 그걸로 찾는다).
 */
export async function 판정기록(text, 판정, 답변자, { announcementId, 특징키, 사유 } = {}) {
  const r = await call("/judgment/record", {
    text, 판정, 답변자,
    announcement_id: announcementId ?? null,
    특징키: 특징키 ?? null,
    사유: 사유 ?? null,
  })
  if (!r.ok) return { ok: false, error: r.error ?? "저장 실패" }
  return { ok: true, row: r.row }
}

/**
 * 뜻이 비슷한 과거 판정 사례를 찾는다. 정답을 대신 정하지 않는다 — 화면은 참고
 * 사례로만 보여준다.
 */
export async function 비슷한사례(text, { topK = 5, minSim = 0.4 } = {}) {
  const r = await call("/judgment/similar", { text, top_k: topK, min_sim: minSim })
  if (!r.ok) return { ok: false, error: r.error ?? "검색 실패", matches: [] }
  return { ok: true, matches: r.matches ?? [] }
}
