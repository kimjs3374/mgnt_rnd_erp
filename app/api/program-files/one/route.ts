import { db } from "@/lib/db"
import { 공개주소 } from "@/lib/storage-url"

/**
 * 서류함에서 **파일 하나** 내려받기 — `/api/program-files/one?key=계상:12`
 *
 * 키가 `출처:id` 인 이유: 파일이 세 표에 흩어져 있어 id 만으로는 서로 겹친다
 * (`lib/program-file-types.ts` 의 `사업파일.키`와 같은 값이다).
 *
 * 저장소 경로를 화면에 내보내지 않는다 — 60초짜리 서명 URL 로 넘긴다.
 * `evidence` 버킷은 비공개고, 그대로 두는 게 규칙이다(공개 URL 에 실데이터 금지).
 */

export const dynamic = "force-dynamic"

const 표 = {
  "계상": "project_evidence_files",
  "정산": "settlement_documents",
  "집행": "evidence",
} as const

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? ""
  const [출처, idRaw] = key.split(":")
  const table = 표[출처 as keyof typeof 표]
  const id = Number(idRaw)
  if (!table || !Number.isFinite(id)) return new Response("키가 잘못됐다", { status: 400 })

  const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle()
  if (error) return new Response(`찾지 못했다: ${error.message}`, { status: 500 })
  const row = data as { storage_path?: string | null; 파일명?: string } | null
  if (!row?.storage_path) return new Response("저장된 파일이 없다", { status: 404 })

  const { data: signed, error: 서명오류 } = await db.storage
    .from("evidence")
    .createSignedUrl(row.storage_path, 60, { download: row.파일명 ?? undefined })
  if (서명오류 || !signed?.signedUrl) {
    return new Response(`내려받기 주소를 만들지 못했다: ${서명오류?.message ?? ""}`, { status: 500 })
  }
  return Response.redirect(공개주소(signed.signedUrl), 302)
}
