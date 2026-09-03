// 공고 판독 — 게이트웨이(127.0.0.1:3611)로 넘긴다. 여기서 claude 를 직접 부르지 않는다.
//
// 2026-09-03 김정수 결정. 그 전까지는 이 파일이 `claude -p` 를 execFileSync 로 직접 불렀고,
// 파이썬(bot/extract.py)도 같은 모델을 따로 불렀다. **프롬프트가 두 벌이었다.**
// 시연 전에 한쪽만 고치면 다른 쪽은 그대로 남고, 그 사고는 조용하다.
// → 판단은 파이썬(bot/gongo.py)이 갖고, 여기는 부르기만 한다. **프롬프트 문구는 그대로 옮겼다.**
//
// 얻은 것: JSON 복구가 튼튼해졌다. 여기 있던 정규식 한 줄은 ```json 펜스나 따옴표 없는 키를
// 만나면 null 을 돌려줬다. 파이썬 `_json_block` 은 그걸 견딘다.
// 잃은 것: 게이트웨이가 죽으면 배치도 못 돈다. `Restart=always` 가 걸려 있고,
//          아래 함수들은 실패를 ok:false 로 돌려주므로 배치는 그대로 다음 건으로 넘어간다.
//
// 게이트웨이 상태:  systemctl status rnd-gateway  ·  journalctl -u rnd-gateway -n 50

const GW = process.env.RND_GW_URL ?? "http://127.0.0.1:3611"
const TIMEOUT = 600_000 // 헤드리스는 호출마다 새 세션이다. 300건 거르기는 분 단위로 간다.

async function call(path, payload) {
  try {
    const res = await fetch(GW + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = await res.json()
    return d ?? { ok: false, error: "빈 응답" }
  } catch (e) {
    // 게이트웨이가 안 떠 있으면 여기로 온다. 배치를 멈추지 않는다.
    return { ok: false, error: `게이트웨이 호출 실패(${GW}${path}): ${e.message}` }
  }
}

/** @deprecated 헤드리스를 직접 부르지 않는다. 새 판독이 필요하면 bot/gongo.py 에 넣고 라우트를 판다. */
export function callClaude() {
  throw new Error(
    "callClaude 는 없앴다. claude 를 여기서 직접 부르지 않는다 — bot/gongo.py 에 추가하고 " +
      "gateway.py 에 라우트를 판 뒤 이 파일에서 call() 로 부를 것. (CLAUDE.md §3.6)",
  )
}

/** sections 는 lib/extract.mjs 의 findSections() 결과. */
export async function extractDocuments(sections) {
  const r = await call("/documents/extract", { sections })
  if (!r.ok) console.error(`  [extractDocuments] ${r.error ?? "(에러 메시지 없음)"}`)
  return { ...r, docs: r.ok ? r.docs : null }
}

/**
 * 공고 상세 패널용 구조화 요약 — 본문에서 한 번만 뽑아 app.ann_summary 에 캐싱한다
 * (scripts/extract-summaries.mjs). 없는 값은 null 로 두고 화면이 "공고문에서 못 찾음"으로
 * 그린다 — 빈 칸을 사람이 지어낸 것처럼 채우지 않는다(§6 설계 원칙 5번).
 */
export async function extractSummary(본문) {
  const r = await call("/summary/extract", { text: 본문 })
  if (!r.ok) console.error(`  [extractSummary] ${r.error ?? "(에러 메시지 없음)"}`)
  return { ...r, summary: r.ok ? r.summary : null }
}

/**
 * 회사 정보 대조 1차 거르기 — 공고 목록(제목+요약)만 보고 후보를 고른다.
 * 첨부파일 다운로드·판독 전 단계라 빠르다. 여기서 걸러진 것만 무거운 파싱으로 넘긴다.
 *
 * 실패하면 null 을 돌려준다 — 호출부가 "최신순 상위 N건"으로 대신 판단하게 한다.
 * **조용히 전체를 걸러버리지 않는다.**
 */
export async function selectRelevant(companyText, candidates) {
  const r = await call("/relevance/select", { company: companyText, candidates })
  if (!r.ok || !Array.isArray(r.picked)) {
    console.error(`  [selectRelevant] ${r.error ?? "(에러 메시지 없음)"}`)
    return null
  }
  // 번호는 1-base. 게이트웨이가 범위 밖 번호를 이미 버리고 준다.
  const idx = new Set(r.picked.map((p) => p.번호))
  return candidates.filter((_, i) => idx.has(i + 1))
}

/**
 * 자격판정 점수 매기기 — 공고 본문을 회사 정보와 대조해 LLM이 0~100점을 준다
 * (bot/gongo.py score_eligibility, /eligibility/score). 규칙표로 대체하지 않는다
 * (CLAUDE.md 9/3 결정 — 판정은 LLM이 한다).
 *
 * ⚠ 게이트웨이에 이 라우트를 새로 추가했다(2026-09-03 mgnt3) — rnd-gateway 를 재시작해야
 *   반영된다. mgnt3 sudoers 에 rnd-gateway 재시작 권한이 없어(rnd-web·rnd-bot 만 있음)
 *   재시작은 김정수(또는 권한 있는 계정)에게 맡겨야 한다. 재시작 전까지는 404 로 실패한다
 *   — 조용히 죽지 않고 ok:false 로 알린다.
 */
export async function scoreEligibility(companyText, 본문) {
  const r = await call("/eligibility/score", { company: companyText, text: 본문 })
  if (!r.ok || !r.result) {
    console.error(`  [scoreEligibility] ${r.error ?? "(에러 메시지 없음)"}`)
    return null
  }
  return r.result
}
