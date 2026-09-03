"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 문서_확장자, 문서파일_점검 } from "@/lib/upload-limits"

/**
 * 비목별 RCMS 증빙 파일 — 업로드 · 다운로드 · 삭제.
 *
 * 저장소는 기존 `evidence` 버킷(비공개)이다. `db/70_storage_rls.sql` 이 INSERT 정책을 일부러
 * 만들지 않았으므로 **브라우저에서 직접 올리는 경로는 없고**, 이 서버 액션(service_role)만 쓴다.
 * 그 결정을 유지하는 편이 낫다 — 사용자 키로 직접 올리게 하면 어느 과제·비목에 속하는지
 * 검증할 자리가 사라진다.
 *
 * ⚠ 개인정보 서류는 코드가 막는다. 요건에 `개인정보포함 = true` 면 업로드를 거부한다
 *   (급여이체증·4대보험 명부·지급대장). CLAUDE.md §5 절대규칙 5 —
 *   「인건비·개인정보는 항목 자체를 만들지 않는다」. 프롬프트나 안내문으로 막지 않는다.
 */

export type ActionResult = { ok: boolean; error?: string; url?: string }

// 크기·확장자 제한은 `lib/upload-limits.ts` 한 곳에 있다(규정 문서함도 같은 것을 쓴다).
// 화면도 같은 것을 보고 미리 거르지만 **최종 판정은 여기서 한다** — 화면 검사는 우회할 수 있다.

export async function uploadEvidenceFile(formData: FormData): Promise<ActionResult> {
  try {
    const 과제_id = Number(formData.get("과제_id"))
    const 비목_대분류 = String(formData.get("비목_대분류") ?? "")
    const 요건_idRaw = formData.get("요건_id")
    const 요건_id = 요건_idRaw ? Number(요건_idRaw) : null
    // 집행 상세에서 올리면 그 건에 매단다. 계상 탭에서 올리면 비어 있다(비목 단위 보관).
    const 집행_idRaw = formData.get("집행_id")
    const 집행_id = 집행_idRaw ? Number(집행_idRaw) : null
    const file = formData.get("file")

    if (!Number.isInteger(과제_id) || 과제_id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }
    if (!비목_대분류) return { ok: false, error: "비목이 없다." }
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일을 고르세요." }
    const 문제 = 문서파일_점검(file)
    if (문제) return { ok: false, error: 문제 }
    const ext = 문서_확장자(file.name)

    // 요건이 지정됐으면 개인정보 여부를 DB 에서 확인한다. 화면 값을 믿지 않는다.
    let 요건명: string | null = null
    if (요건_id != null) {
      const { data, error } = await db
        .from("evidence_requirements")
        .select("*")
        .eq("id", 요건_id)
        .limit(1)
      if (error) return { ok: false, error: error.message }
      const r = (data ?? [])[0] as
        | { 서류명?: string; 개인정보포함?: boolean; 비목_대분류?: string }
        | undefined
      if (!r) return { ok: false, error: "증빙 요건을 찾을 수 없다." }
      if (r.개인정보포함) {
        return {
          ok: false,
          error: `「${r.서류명}」은 개인 급여가 드러나는 서류라 이 시스템에 올리지 않습니다. RCMS 에 직접 제출하세요.`,
        }
      }
      요건명 = r.서류명 ?? null
    }

    const who = await getCurrentUser()

    // 경로는 ASCII 로만 만든다. 한글 파일명을 키에 그대로 넣으면 스토리지가 거부하는 경우가 있다.
    // 원래 파일명은 DB 의 파일명 컬럼에 그대로 남고, 다운로드할 때 그 이름으로 내려간다.
    const path = `projects/${과제_id}/${비목_대분류}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`

    const { error: upErr } = await db.storage
      .from("evidence")
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (upErr) return { ok: false, error: `저장소에 올리지 못했습니다: ${upErr.message}` }

    const { error: insErr } = await db.from("project_evidence_files").insert({
      과제_id,
      비목_대분류,
      요건_id,
      집행_id,
      파일명: file.name,
      storage_path: path,
      크기: file.size,
      mime: file.type || null,
      업로더: who.이름,
      업로더_id: who.id,
      업로더_인증: who.인증,
      비고: 요건명,
    })
    if (insErr) {
      // DB 에 못 남기면 파일만 떠 있게 된다. 목록에 안 뜨는 파일은 없는 파일과 같으니 되돌린다.
      await db.storage.from("evidence").remove([path])
      return { ok: false, error: insErr.message }
    }

    revalidatePath(`/projects/${과제_id}/budget`)
    revalidatePath(`/projects/${과제_id}/settlement`)
    revalidatePath(`/projects/${과제_id}/expenses`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 다운로드 — 60초짜리 서명 URL 을 만들어 준다.
 * 버킷이 비공개라 공개 URL 이 없다. 서명 URL 에 원래 파일명을 실어 보내면
 * 브라우저가 `1735-a8f2.pdf` 대신 `3. 천보_지출결의서.pdf` 로 저장한다.
 */
export async function getEvidenceDownloadUrl(id: number): Promise<ActionResult> {
  try {
    const { data, error } = await db
      .from("project_evidence_files")
      .select("*")
      .eq("id", id)
      .limit(1)
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
export async function deleteEvidenceFile(id: number): Promise<ActionResult> {
  try {
    const { data, error } = await db
      .from("project_evidence_files")
      .select("*")
      .eq("id", id)
      .limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 과제_id?: number } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없다." }

    const { error: rmErr } = await db.storage.from("evidence").remove([f.storage_path])
    // 저장소에서 이미 사라졌더라도 DB 행은 지운다 — 목록에 유령이 남는 게 더 나쁘다.
    if (rmErr) console.error(`[evidence] remove ${f.storage_path}: ${rmErr.message}`)

    const { error: delErr } = await db.from("project_evidence_files").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    if (f.과제_id) {
      revalidatePath(`/projects/${f.과제_id}/budget`)
      revalidatePath(`/projects/${f.과제_id}/settlement`)
      revalidatePath(`/projects/${f.과제_id}/expenses`)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
