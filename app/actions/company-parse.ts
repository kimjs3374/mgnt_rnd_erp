"use server"

import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { 회사서류판독, 자동확정가능 } from "@/lib/doc-ai.mjs"

/**
 * 회사 서류를 올리면 프로필 항목을 읽어 **폼에 채워 넣는다.**
 *
 * ⚠ **DB 에 바로 쓰지 않는다.** 판독 결과를 화면으로 돌려주고, 사람이 보고 「저장」을 누른다.
 *   이 값들로 정부지원사업 신청 자격을 판정하기 때문이다 — 모델이 매출액 단위를 한 자리
 *   틀리면 자격이 없는 공고에 계획서를 쓰게 된다. 서류함(app/actions/documents.ts)은
 *   발급일 하나라 확신도가 높으면 자동 확정하지만, 여기는 항목이 열 개가 넘고
 *   **한 항목만 틀려도 판정이 뒤집힌다.** 그래서 항목별로 확신도를 보여주고 사람이 고른다.
 *
 * 파일은 서류함과 같은 비공개 버킷(company-docs)에 남긴다 — 근거 문서가 없으면
 * 「그 숫자 어디서 나왔냐」에 답할 수 없다. 종류를 알아보면 서류함에도 같이 등록한다.
 */

export type ParseResult = {
  ok: boolean
  message: string
  /** 폼에 채울 값. 사람이 확인하고 저장을 눌러야 DB 에 들어간다. */
  값?: Record<string, unknown>
  /** 항목별 근거 문장 — 서류 원문 인용. 지어낸 값인지 사람이 바로 확인할 수 있어야 한다. */
  근거?: Record<string, string>
  확신도?: number | null
  자동채움?: boolean
  /** 서류함에도 등록됐으면 그 종류 이름. */
  서류함등록?: string | null
}

const 버킷 = "company-docs"
const 최대크기 = 25 * 1024 * 1024
const 판독가능 = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp"])

function 확장자(name: string) {
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i + 1).toLowerCase()
}

/** 판독 결과에서 우리가 쓰는 항목만 골라낸다. 모르는 키는 버린다. */
const 허용항목 = new Set([
  "회사명", "사업자등록번호", "대표자", "소재지", "설립일",
  "업종명", "주요제품", "ksic_코드", "기업규모",
  "결산연도", "매출액", "매출증가율", "부채비율", "rnd_집약도", "종업원수",
  "기업부설연구소", "자본전액잠식",
])

export async function parseCompanyDocument(
  _prev: ParseResult | null,
  formData: FormData,
): Promise<ParseResult> {
  try {
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "파일을 고르세요." }
    if (file.size > 최대크기) {
      return {
        ok: false,
        message: `파일이 ${Math.round(file.size / 1024 / 1024)}MB 입니다. 25MB 까지만 올릴 수 있습니다.`,
      }
    }
    const ext = 확장자(file.name)
    if (!판독가능.has(ext)) {
      return {
        ok: false,
        message: `.${ext || "확장자 없음"} 은 자동 판독을 못 합니다. pdf 나 이미지로 올리세요(hwp 는 서류함에 올려 보관만 됩니다).`,
      }
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // claude -p 는 로컬 파일만 Read 로 읽는다. 임시로 풀어 놓고 반드시 지운다.
    const dir = await mkdtemp(join(tmpdir(), "company-"))
    const 임시 = join(dir, `doc.${ext}`)
    let r: Awaited<ReturnType<typeof 회사서류판독>>
    try {
      await writeFile(임시, bytes)
      r = await 회사서류판독(임시)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }

    if (!r.ok || !r.결과) {
      return { ok: false, message: `판독하지 못했다: ${r.error ?? "이유를 알 수 없다"}` }
    }

    const raw = r.결과 as Record<string, unknown>
    const 확신도 = (raw.확신도 as number | null) ?? null

    const 값: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!허용항목.has(k)) continue
      if (v == null || v === "") continue
      값[k] = v
    }

    const 근거: Record<string, string> = {}
    if (raw.근거 && typeof raw.근거 === "object") {
      for (const [k, v] of Object.entries(raw.근거 as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) 근거[k] = v
      }
    }

    if (Object.keys(값).length === 0) {
      return { ok: false, message: "서류에서 회사 정보를 찾지 못했다. 다른 서류를 올려 보세요." }
    }

    // --- 근거 문서를 남긴다. 「그 숫자 어디서 나왔냐」에 답할 수 있어야 한다. ---
    let 서류함등록: string | null = null
    const path = `company-profile/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await db.storage
      .from(버킷)
      .upload(path, bytes, { contentType: file.type || undefined, upsert: false })

    if (upErr) {
      // 파일을 못 남겨도 판독 결과는 돌려준다 — 사람이 값을 확인하는 데는 지장이 없다.
      console.error(`[company] 근거 파일 저장 실패: ${upErr.message}`)
    } else {
      // 서류 종류를 알아보면 서류함에도 같이 등록한다. 두 번 올릴 이유가 없다.
      const { data: types } = await db.from("doc_types").select("*")
      const 맞는종류 = (types ?? []).find((t: Record<string, unknown>) => {
        const 별칭 = (t.별칭 as string[] | null) ?? []
        return 별칭.some((p) => {
          try {
            return new RegExp(p).test(file.name)
          } catch {
            return false
          }
        })
      }) as Record<string, unknown> | undefined

      const who = await getCurrentUser()
      const { error: insErr } = await db.from("documents").insert({
        doc_type: (맞는종류?.코드 as string) ?? null,
        발급일: null, // 회사 서류 판독은 발급일을 목표로 하지 않는다. 서류함에서 따로 확정한다.
        결산연도: typeof 값.결산연도 === "number" ? 값.결산연도 : null,
        파일명: file.name,
        storage_path: path,
        크기: file.size,
        mime: file.type || null,
        업로더: who.이름,
        업로더_id: who.id,
        업로더_인증: who.인증,
        ai_확신도: 확신도,
        ai_근거: Object.values(근거)[0] ?? null,
        확정_방법: "미확정",
        updated_at: new Date().toISOString(),
      })
      if (insErr) {
        console.error(`[company] documents insert 실패: ${insErr.message}`)
      } else if (맞는종류) {
        서류함등록 = 맞는종류.이름 as string
        revalidatePath("/documents")
      }
    }

    const 자동 = 자동확정가능(확신도)
    return {
      ok: true,
      message: 자동
        ? `${Object.keys(값).length}개 항목을 읽었다. 확인하고 「저장」을 누를 것 — 아직 DB 에 들어가지 않았다.`
        : `${Object.keys(값).length}개 항목을 읽었지만 확신도가 ${확신도 == null ? "불명" : Math.round(확신도 * 100) + "%"}이다. 값을 하나씩 확인할 것.`,
      값,
      근거,
      확신도,
      자동채움: 자동,
      서류함등록,
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
