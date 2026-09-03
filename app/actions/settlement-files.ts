"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 문서_확장자, 문서파일_점검 } from "@/lib/upload-limits"
import { 기간끝났나, 오늘_KST } from "@/lib/settlement-types"

/**
 * 최종 정산 서류 — 업로드 · 다운로드 · 삭제. (2026-09-04 사용자 지시)
 *
 * **협약기간이 끝난 과제만 받는다.** 아직 수행 중인 과제에 「최종」 정산 파일이 붙어 있으면
 * 그 자체가 잘못된 사실이 된다 — 정산은 과제가 끝난 뒤에 하는 일이다.
 * ⚠ 화면에서만 막지 않는다. 화면 검사는 우회할 수 있으므로 **서버가 최종 판정자**다.
 *
 * 저장소는 기존 `evidence` 버킷(비공개)이다. `db/70_storage_rls.sql` 이 INSERT 정책을
 * **일부러** 만들지 않았으므로 브라우저에서 직접 올리는 경로는 없고, 이 서버 액션만 쓴다.
 * 내려주는 것도 60초 서명 URL 뿐이다 — 공개 주소가 존재하지 않는다.
 *
 * ⚠ 실제 정산 파일에는 계좌·인건비·개인정보가 들어 있다(CLAUDE.md §5-5).
 *   로그인 게이트가 없는 지금은 비공개 버킷이 유일한 보호막이다. 제출·시연 상태에서는 비워 둔다.
 *
 * ⚠ 권한(2026-09-04) — 정산 제출(업로드)·삭제는 승인성 조작이라 관리자 이상만 한다.
 *   다운로드는 조회라 전 등급에 연다.
 */

export type SettlementFileResult = {
  ok: boolean
  error?: string
  url?: string
  올린수?: number
}

const t = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim()
  return s || null
}

/** 그 과제가 최종 정산을 받을 수 있는 상태인가. 못 받으면 **사람이 읽을 이유**를 돌려준다. */
async function 정산가능(과제_id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db.from("projects").select("*").eq("id", 과제_id).limit(1)
  if (error) return { ok: false, error: error.message }
  const p = (data ?? [])[0] as
    | { 상태?: string | null; 종료일?: string | null; 과제명?: string | null }
    | undefined
  if (!p) return { ok: false, error: "과제를 찾을 수 없습니다." }
  if (!기간끝났나(p.상태, p.종료일, 오늘_KST())) {
    return {
      ok: false,
      error: `협약기간이 아직 끝나지 않았습니다(종료 ${p.종료일 ?? "미정"}). 최종 정산 서류는 기간이 끝난 뒤에 올립니다.`,
    }
  }
  return { ok: true }
}

/** 파일 여러 개를 한 번에 받는다. **서류종류는 놓는 자리가 정한다**(증빙 첨부와 같은 규칙). */
export async function uploadSettlementDocuments(
  formData: FormData,
): Promise<SettlementFileResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "정산 서류 제출은 관리자 이상만 할 수 있습니다." }
    }

    const 과제_id = Number(formData.get("과제_id") ?? 0)
    if (!과제_id) return { ok: false, error: "어느 과제의 정산인지 알 수 없습니다." }

    const 가능 = await 정산가능(과제_id)
    if (!가능.ok) return { ok: false, error: 가능.error }

    const 서류종류 = String(formData.get("서류종류") ?? "").trim() || "기타"
    const 제출일 = t(formData.get("제출일"))
    const 비고 = t(formData.get("비고"))
    const 연차Raw = formData.get("정산연차")
    const 정산연차 = 연차Raw ? Number(연차Raw) || null : null

    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { ok: false, error: "파일을 고르세요." }

    const 실패: string[] = []
    let 올린수 = 0

    for (const file of files) {
      const 문제 = 문서파일_점검(file)
      if (문제) {
        실패.push(문제)
        continue
      }
      const ext = 문서_확장자(file.name)
      // 경로는 ASCII 로만 만든다. 한글 파일명을 키에 넣으면 스토리지가 거부하는 경우가 있다.
      // 원래 파일명은 DB 에 남고, 내려받을 때 그 이름으로 저장된다.
      const path = `settlement/${과제_id}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`

      const { error: upErr } = await db.storage
        .from("evidence")
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) {
        실패.push(`${file.name} — 저장소에 올리지 못했습니다: ${upErr.message}`)
        continue
      }

      const { error: insErr } = await db.from("settlement_documents").insert({
        과제_id,
        서류종류,
        정산연차,
        제출일,
        비고,
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

    revalidatePath(`/projects/${과제_id}/settlement`)
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

/** 다운로드 — 60초 서명 URL. 버킷이 비공개라 공개 주소가 없다. 조회라 전 등급에 연다. */
export async function getSettlementDownloadUrl(id: number): Promise<SettlementFileResult> {
  try {
    const { data, error } = await db
      .from("settlement_documents")
      .select("*")
      .eq("id", id)
      .limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 파일명?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없습니다." }

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

/**
 * 삭제 — 저장소와 DB 를 같이 지운다. 저장소만 남으면 아무도 못 찾는 쓰레기가 된다.
 *
 * ⚠ 지운 이력을 따로 남기지 않는다. 정산 서류는 **쌓는 것이 원칙**이라(덮어쓰지 않는다)
 *   지우는 건 잘못 올린 파일을 치우는 용도다. 반려·재제출은 새로 올려서 남긴다.
 */
export async function deleteSettlementDocument(id: number): Promise<SettlementFileResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "정산 서류 삭제는 관리자 이상만 할 수 있습니다." }
    }

    const { data, error } = await db
      .from("settlement_documents")
      .select("*")
      .eq("id", id)
      .limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 과제_id?: number } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없습니다." }

    const { error: rmErr } = await db.storage.from("evidence").remove([f.storage_path])
    // 저장소에서 이미 사라졌더라도 DB 행은 지운다 — 목록에 유령이 남는 게 더 나쁘다.
    if (rmErr) console.error(`[settlement] remove ${f.storage_path}: ${rmErr.message}`)

    const { error: delErr } = await db.from("settlement_documents").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    if (f.과제_id) revalidatePath(`/projects/${f.과제_id}/settlement`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
