"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 서류판독, 자동확정가능 } from "@/lib/doc-ai.mjs"

/**
 * 서류함 — 회사 서류 업로드 · 다운로드 · 삭제 · 발급일 확정.
 *
 * 저장소는 **비공개** 버킷 `company-docs` 다. `evidence` 버킷과 같은 방식을 따른다
 * (app/actions/evidence-files.ts, mgnt2) — 브라우저에서 직접 올리는 경로를 두지 않고
 * 이 서버 액션(service_role)만 쓴다. 그래야 어느 서류 종류에 속하는지 검증할 자리가 남는다.
 * 공개 버킷(`announcements`)에 두지 않는다 — 사업자등록증·납세증명서는 회사 실데이터다(§2-6).
 *
 * 올린 뒤 `claude -p` 로 발급일을 읽는다. **확신도 0.70 미만은 코드가 자동 확정을 막는다** —
 * 모델은 모호해도 단정하기 때문이다(§5-3). AI 제안값과 사람 확정값을 따로 저장한다.
 *
 * ⚠ 권한(2026-09-04) — 서류함은 마스터 데이터라 업로드·확정·삭제는 관리자 이상만.
 *   다운로드는 조회라 전 등급에 연다.
 */

export type UploadResult = {
  ok: boolean
  message: string
  제안?: {
    발급일: string | null
    발급기관: string | null
    결산연도: number | null
    근거문장: string | null
    확신도: number | null
    자동확정: boolean
    종류불일치: string | null
  }
}

export type ActionResult = { ok: boolean; error?: string; url?: string }

const 버킷 = "company-docs"
/** 25MB. evidence 버킷과 같은 기준으로 맞춘다. */
const 최대크기 = 25 * 1024 * 1024

/** 증명서로 받는 확장자. 실행 파일을 받지 않는 것이 목적이다. */
const 허용확장자 = new Set([
  "pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx",
  "jpg", "jpeg", "png", "gif", "webp", "heic",
])

/** claude -p 가 Read 로 열 수 있는 형식. 그 밖은 올리기만 하고 판독은 건너뛴다. */
const 판독가능 = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp"])

function 확장자(name: string) {
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i + 1).toLowerCase()
}

export async function uploadDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, message: "서류함 업로드는 관리자 이상만 할 수 있습니다." }
    }

    const doc_type = String(formData.get("doc_type") ?? "").trim()
    const file = formData.get("file")

    if (!doc_type) return { ok: false, message: "서류 종류가 지정되지 않았다." }
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "파일을 고르세요." }
    if (file.size > 최대크기) {
      return {
        ok: false,
        message: `파일이 ${Math.round(file.size / 1024 / 1024)}MB 입니다. 25MB 까지만 올릴 수 있습니다.`,
      }
    }
    const ext = 확장자(file.name)
    if (!허용확장자.has(ext)) {
      return {
        ok: false,
        message: `.${ext || "확장자 없음"} 은 받지 않습니다. 증명서는 pdf·hwp·xlsx·이미지로 올리세요.`,
      }
    }

    // 종류를 화면 값만 믿지 않고 DB 에서 확인한다. 판독이 고른 종류와 대조하는 데도 쓴다.
    const { data: types, error: tErr } = await db.from("doc_types").select("*")
    if (tErr) return { ok: false, message: tErr.message }
    const 이_종류 = (types ?? []).find(
      (t: Record<string, unknown>) => t.코드 === doc_type,
    ) as Record<string, unknown> | undefined
    if (!이_종류) return { ok: false, message: `모르는 서류 종류다: ${doc_type}` }
    const 종류이름 = (types ?? []).map((t: Record<string, unknown>) => t.이름 as string)

    // 경로는 ASCII 로만 만든다. 한글 파일명을 스토리지 키에 넣으면 거부되는 경우가 있다.
    // 원래 이름은 파일명 컬럼에 남고 다운로드할 때 그 이름으로 내려간다(evidence 와 같은 규칙).
    const path = `${doc_type}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const bytes = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await db.storage
      .from(버킷)
      .upload(path, bytes, { contentType: file.type || undefined, upsert: false })
    if (upErr) return { ok: false, message: `저장소에 올리지 못했습니다: ${upErr.message}` }

    // --- 판독. 실패해도 파일은 남긴다 — 사람이 발급일을 직접 넣으면 그만이다. ---
    // claude -p 는 로컬 파일만 Read 로 읽는다. 임시 디렉터리에 잠깐 풀어 놓고 지운다.
    let 제안: UploadResult["제안"]
    let 발급일: string | null = null
    let 결산연도: number | null = null
    let 확정_방법 = "미확정"
    let 판독오류: string | null = null

    if (판독가능.has(ext)) {
      // 임시 파일을 만들지 않는다 — 게이트웨이는 PrivateTmp 라 우리 /tmp 를 못 본다.
      // 바이트를 그대로 넘기면 게이트웨이가 자기 쪽에 풀어 읽고 지운다(lib/doc-ai.mjs 주석).
      try {
        const r = await 서류판독(bytes, ext, 종류이름)
        if (r.ok && r.결과) {
          const c = r.결과.확신도
          const 자동 = 자동확정가능(c)
          // 판독이 고른 종류가 사용자가 고른 것과 다르면 알려준다. 자동으로 바꾸지 않는다 —
          // 사용자가 맞고 모델이 틀렸을 수 있다.
          const 불일치 =
            r.결과.서류종류 && r.결과.서류종류 !== (이_종류.이름 as string)
              ? (r.결과.서류종류 as string)
              : null
          제안 = {
            발급일: r.결과.발급일,
            발급기관: r.결과.발급기관,
            결산연도: r.결과.결산연도,
            근거문장: r.결과.근거문장,
            확신도: c,
            자동확정: 자동,
            종류불일치: 불일치,
          }
          if (자동) {
            발급일 = r.결과.발급일
            결산연도 = r.결과.결산연도
            확정_방법 = "ai_자동"
          }
        } else {
          판독오류 = r.error ?? "판독 실패"
        }
      } catch (e) {
        판독오류 = e instanceof Error ? e.message : String(e)
      }
    } else {
      판독오류 = `.${ext} 는 자동 판독 대상이 아닙니다(pdf·이미지만)`
    }

    const { error: insErr } = await db.from("documents").insert({
      doc_type,
      발급일,
      결산연도,
      파일명: file.name,
      storage_path: path,
      크기: file.size,
      mime: file.type || null,
      발급기관: 제안?.발급기관 ?? null,
      업로더: who.이름,
      업로더_id: who.id,
      업로더_인증: who.인증,
      ai_발급일: 제안?.발급일 ?? null,
      ai_확신도: 제안?.확신도 ?? null,
      ai_근거: 제안?.근거문장 ?? null,
      확정_방법,
      updated_at: new Date().toISOString(),
    })
    if (insErr) {
      // DB 에 못 남기면 파일만 떠 있게 된다. 목록에 안 뜨는 파일은 없는 파일과 같으니 되돌린다.
      await db.storage.from(버킷).remove([path])
      return { ok: false, message: insErr.message }
    }

    revalidatePath("/documents")
    revalidatePath("/dashboard")

    if (판독오류) {
      return { ok: true, message: `올렸다. 자동 판독은 못 했다(${판독오류}) — 발급일을 직접 넣을 것.`, 제안 }
    }
    if (!제안?.자동확정) {
      return {
        ok: true,
        message:
          제안?.확신도 == null
            ? "올렸다. 발급일을 못 읽었다 — 직접 넣을 것."
            : `올렸다. 판독 확신도가 ${Math.round((제안.확신도 ?? 0) * 100)}%라 자동 확정하지 않았다 — 확인 후 저장할 것.`,
        제안,
      }
    }
    return { ok: true, message: `올렸다. 발급일 ${발급일} 로 확정했다.`, 제안 }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 다운로드 — 60초 서명 URL. 버킷이 비공개라 공개 URL 이 없다.
 * 원래 파일명을 실어 보내면 브라우저가 `1735-a8f2.pdf` 대신 `사업자등록증.pdf` 로 저장한다.
 * 조회라 전 등급에 연다.
 */
export async function getDocumentDownloadUrl(id: number): Promise<ActionResult> {
  try {
    const { data, error } = await db.from("documents").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string; 파일명?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없다." }

    const { data: signed, error: sErr } = await db.storage
      .from(버킷)
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
 * 발급일·결산연도를 사람이 확정한다.
 * AI 제안과 같으면 「사람_확인」, 다르면 「사람_수정」으로 남는다 —
 * **「AI가 뭘 제안했고 사람이 뭘로 확정했는가」가 이 시스템의 핵심 기록이다**(§5-1).
 */
export async function confirmDocument(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const who = await getCurrentUser()
  if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
    return { ok: false, message: "서류함 확정은 관리자 이상만 할 수 있습니다." }
  }

  const id = Number(formData.get("id"))
  if (!Number.isInteger(id)) return { ok: false, message: "잘못된 요청이다." }

  const 발급일 = String(formData.get("발급일") ?? "").trim() || null
  const 결산연도값 = String(formData.get("결산연도") ?? "").trim()
  const 결산연도 = 결산연도값 === "" ? null : Number(결산연도값)

  const { data } = await db.from("documents").select("*").eq("id", id).limit(1)
  const before = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!before) return { ok: false, message: "그 서류를 찾을 수 없다." }

  const { error } = await db
    .from("documents")
    .update({
      발급일,
      결산연도: Number.isFinite(결산연도) ? 결산연도 : null,
      확정_방법: before.ai_발급일 === 발급일 ? "사람_확인" : "사람_수정",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { ok: false, message: `저장 실패: ${error.message}` }
  revalidatePath("/documents")
  return { ok: true, message: "확정했다." }
}

/** 삭제 — 저장소와 DB 를 같이 지운다. 저장소만 남으면 아무도 못 찾는 쓰레기가 된다. */
export async function deleteDocument(id: number): Promise<ActionResult> {
  try {
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "서류함 삭제는 관리자 이상만 할 수 있습니다." }
    }

    const { data, error } = await db.from("documents").select("*").eq("id", id).limit(1)
    if (error) return { ok: false, error: error.message }
    const f = (data ?? [])[0] as { storage_path?: string } | undefined
    if (!f?.storage_path) return { ok: false, error: "파일을 찾을 수 없다." }

    const { error: rmErr } = await db.storage.from(버킷).remove([f.storage_path])
    // 저장소에서 이미 사라졌더라도 DB 행은 지운다 — 목록에 유령이 남는 게 더 나쁘다.
    if (rmErr) console.error(`[documents] remove ${f.storage_path}: ${rmErr.message}`)

    const { error: delErr } = await db.from("documents").delete().eq("id", id)
    if (delErr) return { ok: false, error: delErr.message }

    revalidatePath("/documents")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
