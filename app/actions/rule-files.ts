"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 문서_확장자, 문서파일_점검 } from "@/lib/upload-limits"

/**
 * 규정·공고 원문 문서함 — 업로드 · 다운로드 · 삭제.
 *
 * **규정은 사업마다 다르다.** 그래서 파일도 규칙과 **같은 축**에 매단다 —
 * 공고 > 사업유형 > 공통(`app.funding_share_rules` 의 우선순위와 같다, `db/98` 참조).
 * 축이 어긋나면 「이 과제에 적용되는 규정」을 한 번에 모을 수 없다.
 *
 * 저장소는 기존 `evidence` 버킷(비공개)이다. `db/70_storage_rls.sql` 이 INSERT 정책을 일부러
 * 만들지 않았으므로 브라우저에서 직접 올리는 경로는 없고, 이 서버 액션(service_role)만 쓴다.
 */

// ⚠ `"use server"` 파일은 **export 가 전부 async 함수**여야 한다. 타입·상수는 여기 두지 못한다
//   (넣으면 빌드가 깨진다). 그래서 `lib/rule-types.ts` 로 나가 있다.
import type { 적용범위 as 범위 } from "@/lib/rule-types"

export type RuleActionResult = { ok: boolean; error?: string; url?: string; 올린수?: number }

/** 범위와 키의 짝. DB CHECK 와 같은 규칙을 여기서 먼저 걸러 사람이 읽을 말로 돌려준다. */
function 범위점검(
  적용범위: string,
  announcement_id: number | null,
  사업유형: string | null,
): { ok: true; 범위: 범위 } | { ok: false; error: string } {
  if (적용범위 === "공고") {
    if (!announcement_id) return { ok: false, error: "어느 공고의 규정인지 고르세요." }
    return { ok: true, 범위: "공고" }
  }
  if (적용범위 === "사업유형") {
    if (!사업유형) return { ok: false, error: "어느 사업유형의 규정인지 고르세요." }
    return { ok: true, 범위: "사업유형" }
  }
  if (적용범위 === "공통") return { ok: true, 범위: "공통" }
  return { ok: false, error: "적용 범위는 공고·사업유형·공통 중 하나여야 합니다." }
}

/**
 * 파일 여러 개를 한 번에 받는다(드래그드랍은 폴더에서 통째로 끌어온다).
 *
 * 메타(제목·문서종류·발행기관…)는 **한 벌만** 받는다. 여러 개를 올릴 때 제목을 하나로 묶으면
 * 두 번째 파일부터 제목이 거짓이 되므로, **제목이 비면 파일명을 제목으로 쓴다.**
 * 지어내지 않고 사람이 준 것만 남긴다.
 */
export async function uploadRuleDocuments(formData: FormData): Promise<RuleActionResult> {
  try {
    const 적용범위Raw = String(formData.get("적용범위") ?? "")
    const annRaw = formData.get("announcement_id")
    const 사업유형Raw = formData.get("사업유형")
    const announcement_id = annRaw ? Number(annRaw) : null
    const 사업유형 = 사업유형Raw ? String(사업유형Raw) : null

    const 범위 = 범위점검(적용범위Raw, announcement_id, 사업유형)
    if (!범위.ok) return { ok: false, error: 범위.error }

    const 문서종류 = String(formData.get("문서종류") ?? "").trim() || "기타"
    const 제목입력 = String(formData.get("제목") ?? "").trim()
    const 발행기관 = String(formData.get("발행기관") ?? "").trim() || null
    const 발행일Raw = String(formData.get("발행일") ?? "").trim()
    const 발행일 = 발행일Raw || null
    const 버전 = String(formData.get("버전") ?? "").trim() || null
    const 근거메모 = String(formData.get("근거메모") ?? "").trim() || null

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { ok: false, error: "파일을 고르세요." }

    const who = await getCurrentUser()
    // 범위별로 경로를 갈라 둔다. 나중에 「이 공고 것만」 지울 때 경로만 보고도 된다.
    const 키 =
      범위.범위 === "공고" ? `ann-${announcement_id}`
      : 범위.범위 === "사업유형" ? String(사업유형)
      : "common"

    const 실패: string[] = []
    let 올린수 = 0

    for (const file of files) {
      const 문제 = 문서파일_점검(file)
      if (문제) {
        실패.push(문제)
        continue
      }
      const ext = 문서_확장자(file.name)
      // 경로는 ASCII 로만 만든다. 한글 파일명을 키에 그대로 넣으면 스토리지가 거부하는 경우가 있다.
      // 원래 파일명은 DB 에 남고, 다운로드할 때 그 이름으로 내려간다.
      const path = `rules/${범위.범위 === "공고" ? "ann" : 범위.범위 === "사업유형" ? "scheme" : "common"}/${키}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`

      const { error: upErr } = await db.storage
        .from("evidence")
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) {
        실패.push(`${file.name} — 저장소에 올리지 못했습니다: ${upErr.message}`)
        continue
      }

      const { error: insErr } = await db.from("rule_documents").insert({
        적용범위: 범위.범위,
        announcement_id: 범위.범위 === "공고" ? announcement_id : null,
        사업유형: 범위.범위 === "사업유형" ? 사업유형 : null,
        문서종류,
        // 여러 개를 올릴 때 제목을 하나로 묶으면 두 번째부터 거짓이 된다 — 그때는 파일명이 사실이다.
        제목: 제목입력 && files.length === 1 ? 제목입력 : (제목입력 ? `${제목입력} — ${file.name}` : file.name),
        발행기관,
        발행일,
        버전,
        근거메모,
        파일명: file.name,
        storage_path: path,
        크기: file.size,
        mime: file.type || null,
        업로더: who.이름,
        업로더_id: who.id,
        업로더_인증: who.인증,
      })
      if (insErr) {
        // DB 에 못 남기면 파일만 떠 있게 된다. 목록에 안 뜨는 파일은 없는 파일과 같으니 되돌린다.
        await db.storage.from("evidence").remove([path])
        실패.push(`${file.name} — ${insErr.message}`)
        continue
      }
      올린수++
    }

    revalidatePath("/rules")
    if (announcement_id) revalidatePath(`/announcements/${announcement_id}`)

    if (실패.length) {
      return {
        ok: 올린수 > 0,
        올린수,
        error: `${올린수 ? `${올린수}건 올렸습니다. ` : ""}${실패.length}건 실패 — ${실패.join(" / ")}`,
      }
    }
    return { ok: true, 올린수 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 다운로드 — 60초 서명 URL. 버킷이 비공개라 공개 주소가 없다. */
export async function getRuleDownloadUrl(id: number): Promise<RuleActionResult> {
  try {
    const { data, error } = await db.from("rule_documents").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 파일명?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없다." }

    const { data: signed, error: sErr } = await db.storage
      .from("evidence")
      .createSignedUrl(f.storage_path, 60, { download: f.파일명 ?? undefined })
    if (sErr || !signed?.signedUrl) {
      return { ok: false, error: sErr?.message ?? "내려받을 주소를 만들지 못했습니다." }
    }
    return { ok: true, url: signed.signedUrl }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 삭제 — 저장소와 DB 를 같이 지운다. 저장소만 남으면 아무도 못 찾는 쓰레기가 된다. */
export async function deleteRuleDocument(id: number): Promise<RuleActionResult> {
  try {
    const { data, error } = await db.from("rule_documents").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; announcement_id?: number | null } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없다." }

    const { error: rmErr } = await db.storage.from("evidence").remove([f.storage_path])
    // 저장소에서 이미 사라졌더라도 DB 행은 지운다 — 목록에 유령이 남는 게 더 나쁘다.
    if (rmErr) console.error(`[rules] remove ${f.storage_path}: ${rmErr.message}`)

    const { error: delErr } = await db.from("rule_documents").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    revalidatePath("/rules")
    if (f.announcement_id) revalidatePath(`/announcements/${f.announcement_id}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
