"use server"

import { revalidatePath } from "next/cache"
import { db, safeSelect } from "@/lib/db"
import { getCurrentUser, 미인증_업로더 } from "@/lib/current-user"
import { 문구짚기 } from "@/lib/rules-ai.mjs"
// ⚠ 특징키 목록은 lib/lexicon-keys.ts 에 둔다 — "use server" 파일은 async 함수만
//   export 할 수 있어서, 여기서 상수를 내보내면 클라이언트가 배열 대신 서버액션
//   프록시를 받아 화면이 죽는다(실제로 그렇게 냈다. 그 파일 주석 참고).
import { 문구_특징키, type 문구특징키 } from "@/lib/lexicon-keys"

/**
 * 공고문에서 **사람이 중요한 문구를 짚는다** — 그 문구가 추출 규칙이 된다.
 *
 * 사용자 요청(2026-09-04): "공고문에서 필수 체크해야하는 단어들이나 중요하게 판단해야
 * 하는 단어들 공고문에서 사람이 지정해주고 해당내용 학습하도록 뭔가 조치가 필요함"
 *
 * 백엔드는 이미 다 있었다 — bot/ann_rules.record_answer() 가 짚은 문구를
 * app.extraction_lexicon 에 넣고, bot/ann_features.scan_lexicon() 이 **정규식보다 먼저**
 * 적용하며, 그 공고를 즉시 다시 판정한다. 없던 것은 사람이 짚을 화면뿐이었다.
 *
 * judgment_semantic(의미 학습)과 다른 층이다:
 *   judgment_semantic   문구가 달라도 뜻이 비슷하면 걸린다(임베딩, 정황)
 *   extraction_lexicon  문구가 글자 그대로 있으면 걸린다(부분문자열, 확정)
 * 이건 후자다 — 그래서 게이트로 쓸 수 있고, 걸리면 「불가」가 확정된다.
 */

export type MarkResult = {
  ok: boolean
  error?: string
  /** 짚은 뒤 다시 판정한 결과. 화면이 "확인필요 → 불가"처럼 보여준다. */
  새판정?: string
  확신도?: number
  동기화?: string
}

export async function markImportantPhrase(input: {
  announcementId: number
  짚은문구: string
  특징키: 문구특징키
  값: string
  사유?: string
}): Promise<MarkResult> {
  try {
    const 짚은문구 = input.짚은문구.trim()
    const 값 = input.값.trim()
    if (짚은문구.replace(/\s+/g, "").length < 4) {
      return { ok: false, error: "짚은 문구가 너무 짧다 — 아무 공고에나 걸린다. 문장을 더 담아라." }
    }
    if (!값) {
      return { ok: false, error: "이 문구가 뜻하는 값을 적어야 한다 (예: 농특산품 생산·가공업체)." }
    }
    if (!문구_특징키.some((k) => k.v === input.특징키)) {
      return { ok: false, error: "특징키가 올바르지 않다." }
    }

    const user = await getCurrentUser()
    const 답변자 = user.인증 ? user.이름 : 미인증_업로더

    const r = await 문구짚기({
      announcementId: input.announcementId,
      짚은문구,
      특징키: input.특징키,
      값,
      답변자,
      사유: input.사유?.trim() || undefined,
    })
    if (!r.ok) return { ok: false, error: r.error }

    revalidatePath("/announcements")
    revalidatePath("/project-announcements")
    return {
      ok: true,
      새판정: r.판정?.판정,
      확신도: r.판정?.확신도,
      동기화: r.동기화 ?? undefined,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export type LexiconRow = {
  id: number
  패턴: string
  특징키: string
  값_텍스트: string | null
  신뢰도: number
  만든이: string
  적용횟수: number
  사용중: boolean
  created_at: string
}

/** 지금까지 사람이 짚어 쌓인 규칙. 몇 건이 쌓였는지가 곧 "학습되고 있다"의 증거다. */
export async function getLexicon(): Promise<{ rows: LexiconRow[]; error: string | null }> {
  const { rows, error } = await safeSelect<LexiconRow>("extraction_lexicon", () =>
    db.from("extraction_lexicon").select("*").order("created_at", { ascending: false }).limit(50),
  )
  return { rows, error }
}
