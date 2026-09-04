"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 문서_확장자, 문서파일_점검 } from "@/lib/upload-limits"
import { 공개주소 } from "@/lib/storage-url"

/**
 * 회사 표준 양식(서식) — 올리기 · 받기 · 지우기.
 *
 * **문서 통일화가 목적이다.** 증빙 서류 이름은 이미 `app.evidence_requirements` 에 있는데
 * (견적의뢰서 · 지출결의서 · 검수조서 …), 그 서류를 **무슨 양식으로 쓰는지**는 사람마다 달랐다.
 * 각자 예전 파일을 복사해 쓰니 같은 지출결의서가 과제마다 다른 모양으로 나간다.
 * 여기 올린 파일 하나가 그 서류의 회사 표준이 되고, 계상 탭에서 받아 쓰면 양식이 통일된다.
 *
 * ⚠ **서류명 하나에 표준 하나**(사업유형별로만 갈린다 — RCMS 지출결의서와 지자체 것은 서식이 다르다).
 *   같은 자리에 새로 올리면 **교체**하고 이전 파일은 스토리지에서 지운다.
 *   둘을 남겨 두면 어느 것이 표준인지 다시 알 수 없어져서, 통일하려던 목적 자체가 사라진다.
 */

export type FormResult = { ok: boolean; error?: string; url?: string; 교체됨?: boolean }

export async function uploadFormTemplate(formData: FormData): Promise<FormResult> {
  try {
    const 서류명 = String(formData.get("서류명") ?? "").trim()
    const 사업유형Raw = formData.get("사업유형")
    const 사업유형 = 사업유형Raw ? String(사업유형Raw) : null
    const 버전 = String(formData.get("버전") ?? "").trim() || null
    const 설명 = String(formData.get("설명") ?? "").trim() || null
    const file = formData.get("file")

    if (!서류명) return { ok: false, error: "어느 서류의 양식인지 골라 주세요." }
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일을 고르세요." }
    const 문제 = 문서파일_점검(file)
    if (문제) return { ok: false, error: 문제 }

    // 같은 자리에 이미 표준이 있는지. 있으면 교체한다.
    const { data: 기존, error: selErr } = await db
      .from("form_templates")
      .select("*")
      .eq("서류명", 서류명)
    if (selErr) return { ok: false, error: selErr.message }
    const 겹침 = (기존 ?? []).find(
      (t: { 사업유형?: string | null }) => (t.사업유형 ?? null) === 사업유형,
    ) as { id?: number; storage_path?: string } | undefined

    const who = await getCurrentUser()
    const ext = 문서_확장자(file.name)
    // 경로는 ASCII 로만 만든다. 한글 파일명을 키에 넣으면 스토리지가 거부하는 경우가 있다.
    const path = `forms/${사업유형 ?? "common"}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`

    const { error: upErr } = await db.storage
      .from("evidence")
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (upErr) return { ok: false, error: `저장소에 올리지 못했습니다: ${upErr.message}` }

    const row = {
      서류명,
      사업유형,
      버전,
      설명,
      파일명: file.name,
      storage_path: path,
      크기: file.size,
      mime: file.type || null,
      업로더: who.이름,
      업로더_id: who.id,
      업로더_인증: who.인증,
      업로드일시: new Date().toISOString(),
    }

    if (겹침?.id) {
      const { error } = await db.from("form_templates").update(row).eq("id", 겹침.id)
      if (error) {
        await db.storage.from("evidence").remove([path])
        return { ok: false, error: error.message }
      }
      // 새 행이 자리를 잡은 다음에 옛 파일을 지운다. 순서를 바꾸면 실패했을 때 둘 다 잃는다.
      if (겹침.storage_path) await db.storage.from("evidence").remove([겹침.storage_path])
    } else {
      const { error } = await db.from("form_templates").insert(row)
      if (error) {
        await db.storage.from("evidence").remove([path])
        return { ok: false, error: error.message }
      }
    }

    // 계상 탭이 이 목록을 쓴다. 과제마다 경로가 달라 통째로 다시 그리게 한다.
    revalidatePath("/projects", "layout")
    return { ok: true, 교체됨: !!겹침?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 받기 — 60초 서명 URL. 버킷이 비공개라 공개 주소가 없다. */
export async function getFormTemplateUrl(id: number): Promise<FormResult> {
  try {
    const { data, error } = await db.from("form_templates").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 파일명?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "양식을 찾을 수 없다." }

    const { data: signed, error: sErr } = await db.storage
      .from("evidence")
      .createSignedUrl(f.storage_path, 60, { download: f.파일명 ?? undefined })
    if (sErr || !signed?.signedUrl) {
      return { ok: false, error: sErr?.message ?? "내려받을 주소를 만들지 못했습니다." }
    }
    return { ok: true, url: 공개주소(signed.signedUrl) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function deleteFormTemplate(id: number): Promise<FormResult> {
  try {
    const { data, error } = await db.from("form_templates").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "양식을 찾을 수 없다." }

    const { error: rmErr } = await db.storage.from("evidence").remove([f.storage_path])
    // 저장소에서 이미 사라졌더라도 DB 행은 지운다 — 목록에 유령이 남는 게 더 나쁘다.
    if (rmErr) console.error(`[forms] remove ${f.storage_path}: ${rmErr.message}`)

    const { error: delErr } = await db.from("form_templates").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    revalidatePath("/projects", "layout")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
