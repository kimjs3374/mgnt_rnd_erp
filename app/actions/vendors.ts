"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 문서_확장자, 문서파일_점검 } from "@/lib/upload-limits"
import { 사업자번호_숫자만, 사업자번호_점검 } from "@/lib/vendor-types"
import { 공개주소 } from "@/lib/storage-url"

/**
 * 업체(거래처) 대장 — 등록·수정 · 사업자등록증/통장사본 업로드 · 다운로드 · 삭제.
 *
 * 이 서류들은 **과제가 아니라 업체에 붙는다.** 한 번 받아서 여러 과제·여러 집행 건에 쓴다
 * (`db/101_vendors.sql` 의 설계 주석 참조).
 *
 * 저장소는 기존 `evidence` 버킷(비공개)이다. `db/70_storage_rls.sql` 이 INSERT 정책을
 * **일부러** 만들지 않았으므로 브라우저에서 직접 올리는 경로는 없고, 이 서버 액션(service_role)만 쓴다.
 * 내려주는 것도 60초 서명 URL 뿐이다 — 공개 주소가 존재하지 않는다.
 *
 * ⚠ 계좌번호를 마스킹하지 않는다(2026-09-03 사용자 결정 — 내부 인원이 공유하는 화면).
 *   화면 값(계좌번호·업체명)은 페이지를 여는 사람이면 그대로 본다.
 *   **실제 통장사본을 올리면 그건 실데이터다**(CLAUDE.md §5-5) — 게이트가 붙기 전에는 비워 둔다.
 *
 * ⚠ 권한(2026-09-04) — 업체 대장은 마스터 데이터라 등록·수정·서류 업로드·삭제는 관리자 이상만.
 *   다운로드는 조회라 전 등급에 연다.
 */

export type VendorActionResult = {
  ok: boolean
  error?: string
  url?: string
  id?: number
  올린수?: number
}

/** 빈 문자열은 null 로. 「빈칸」과 「모른다」를 DB 에서 같게 둔다. */
const t = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim()
  return s || null
}

/**
 * 업체 등록·수정. `id` 가 있으면 수정이다.
 *
 * 사업자번호는 **숫자만** 남겨 저장한다 — 표기가 섞이면 집행 건과 못 붙는다.
 * 번호를 모르는 채로 등록하는 것은 막지 않는다(등록증을 받기 전인 업체가 실제로 있다).
 */
export async function saveVendor(formData: FormData): Promise<VendorActionResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "업체 등록·수정은 관리자 이상만 할 수 있습니다." }
    }

    const idRaw = formData.get("id")
    const id = idRaw ? Number(idRaw) : null
    const 업체명 = String(formData.get("업체명") ?? "").trim()
    if (!업체명) return { ok: false, error: "업체명은 있어야 합니다." }

    const 번호Raw = String(formData.get("사업자번호") ?? "")
    const 문제 = 사업자번호_점검(번호Raw)
    if (문제) return { ok: false, error: 문제 }
    const 사업자번호 = 사업자번호_숫자만(번호Raw) || null

    const row = {
      업체명,
      사업자번호,
      대표자: t(formData.get("대표자")),
      업태: t(formData.get("업태")),
      종목: t(formData.get("종목")),
      주소: t(formData.get("주소")),
      연락처: t(formData.get("연락처")),
      이메일: t(formData.get("이메일")),
      은행: t(formData.get("은행")),
      // 계좌번호도 숫자·하이픈이 섞여 들어온다. 사람이 통장사본에서 옮겨 적은 값을 그대로 둔다 —
      // 은행마다 자릿수와 구분 위치가 달라 정규화하면 오히려 틀린다.
      계좌번호: t(formData.get("계좌번호")),
      예금주: t(formData.get("예금주")),
      비고: t(formData.get("비고")),
      updated_at: new Date().toISOString(),
    }

    if (id) {
      const { error } = await db.from("vendors").update(row).eq("id", id)
      if (error) return { ok: false, error: 중복이면(error.message, 사업자번호) }
      revalidatePath("/vendors")
      return { ok: true, id }
    }

    const { data, error } = await db.from("vendors").insert(row).select("*")
    if (error) return { ok: false, error: 중복이면(error.message, 사업자번호) }
    revalidatePath("/vendors")
    return { ok: true, id: (data ?? [])[0]?.id as number | undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** unique 위반은 DB 문구 그대로 보여주면 아무도 못 알아본다. 사람 말로 바꾼다. */
function 중복이면(msg: string, 사업자번호: string | null): string {
  if (msg.includes("vendors_사업자번호_key") || msg.includes("duplicate key")) {
    return `사업자번호 ${사업자번호 ?? ""} 는 이미 대장에 있습니다. 그 업체를 열어 고치세요.`
  }
  return msg
}

/**
 * 서류 여러 개를 한 번에 받는다(등록증·통장사본을 한꺼번에 끌어오는 게 보통이다).
 * **서류종류는 놓는 자리가 정한다** — 증빙 첨부·규정 문서함과 같은 규칙이다.
 */
export async function uploadVendorDocuments(formData: FormData): Promise<VendorActionResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "업체 서류 업로드는 관리자 이상만 할 수 있습니다." }
    }

    const 업체_id = Number(formData.get("업체_id") ?? 0)
    if (!업체_id) return { ok: false, error: "어느 업체의 서류인지 알 수 없습니다." }

    const { data: v, error: vErr } = await db.from("vendors").select("*").eq("id", 업체_id).limit(1)
    if (vErr) return { ok: false, error: vErr.message }
    if (!(v ?? []).length) return { ok: false, error: "대장에 없는 업체입니다." }

    const 서류종류 = String(formData.get("서류종류") ?? "").trim() || "기타"
    const 발급일 = t(formData.get("발급일"))
    const 비고 = t(formData.get("비고"))

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
      // 경로는 ASCII 로만 만든다. 한글 파일명을 키에 그대로 넣으면 스토리지가 거부하는 경우가 있다.
      // 원래 파일명은 DB 에 남고, 내려받을 때 그 이름으로 저장된다.
      const path = `vendors/${업체_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: upErr } = await db.storage
        .from("evidence")
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) {
        실패.push(`${file.name} — 저장소에 올리지 못했습니다: ${upErr.message}`)
        continue
      }

      const { error: insErr } = await db.from("vendor_documents").insert({
        업체_id,
        서류종류,
        발급일,
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

    revalidatePath("/vendors")
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
export async function getVendorDownloadUrl(id: number): Promise<VendorActionResult> {
  try {
    const { data, error } = await db.from("vendor_documents").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 파일명?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없습니다." }

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

/** 서류 삭제 — 저장소와 DB 를 같이 지운다. 저장소만 남으면 아무도 못 찾는 쓰레기가 된다. */
export async function deleteVendorDocument(id: number): Promise<VendorActionResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "업체 서류 삭제는 관리자 이상만 할 수 있습니다." }
    }

    const { data, error } = await db.from("vendor_documents").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없습니다." }

    const { error: rmErr } = await db.storage.from("evidence").remove([f.storage_path])
    // 저장소에서 이미 사라졌더라도 DB 행은 지운다 — 목록에 유령이 남는 게 더 나쁘다.
    if (rmErr) console.error(`[vendors] remove ${f.storage_path}: ${rmErr.message}`)

    const { error: delErr } = await db.from("vendor_documents").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    revalidatePath("/vendors")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 업체 삭제. **집행 건이 붙어 있으면 막는다** — 그 업체로 나간 돈의 서류 출처가 사라진다.
 * 서류 파일은 DB 의 cascade 로 행이 지워지기 전에 저장소에서 먼저 치운다.
 */
export async function deleteVendor(id: number): Promise<VendorActionResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "업체 삭제는 관리자 이상만 할 수 있습니다." }
    }

    const { data: v, error: vErr } = await db.from("v_vendor_status").select("*").eq("id", id).limit(1)
    if (vErr) return { ok: false, error: vErr.message }
    const 업체 = (v ?? [])[0] as { 집행건수?: number; 업체명?: string } | undefined
    if (!업체) return { ok: false, error: "대장에 없는 업체입니다." }
    if (Number(업체.집행건수 ?? 0) > 0) {
      return {
        ok: false,
        error: `${업체.업체명} 로 나간 집행이 ${업체.집행건수}건 있어 지울 수 없습니다. 정산 근거가 사라집니다.`,
      }
    }

    const { data: docs } = await db.from("vendor_documents").select("*").eq("업체_id", id)
    const paths = (docs ?? [])
      .map((d) => (d as { storage_path?: string }).storage_path)
      .filter((p): p is string => !!p)
    if (paths.length) {
      const { error: rmErr } = await db.storage.from("evidence").remove(paths)
      if (rmErr) console.error(`[vendors] remove ${paths.length}건: ${rmErr.message}`)
    }

    const { error: delErr } = await db.from("vendors").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    revalidatePath("/vendors")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
