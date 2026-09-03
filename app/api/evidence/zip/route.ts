import { db } from "@/lib/db"
import { makeZip, uniqueNames, type ZipEntry } from "@/lib/zip"

/**
 * 증빙 한 번에 내려받기 — `/api/evidence/zip?expense=12` 또는 `?project=2&category=FACILITY`
 *
 * 왜 라우트 핸들러인가: 서버 액션은 바이너리를 돌려주기에 맞지 않다(직렬화를 거친다).
 * 파일을 스토리지에서 서버가 받아 zip 으로 묶어 그대로 흘려보낸다.
 * 브라우저에는 **서명 URL 을 여러 개 던지지 않는다** — 팝업 차단에 걸리고,
 * 사람이 받아야 하는 건 「이 집행 건의 증빙 한 묶음」이다.
 *
 * ⚠ 지금은 로그인 게이트가 없어 이 경로도 열려 있다. 게이트가 붙으면 여기도 세션 확인을
 *   거쳐야 한다 — 증빙은 공개 대상이 아니다(`db/70_storage_rls.sql`).
 */

export const dynamic = "force-dynamic"

/** 파일명에 쓸 수 없는 문자만 걷어낸다. 한글은 그대로 둔다(zip 이 UTF-8 플래그를 세운다). */
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)

export async function GET(req: Request) {
  const url = new URL(req.url)
  const expense = url.searchParams.get("expense")
  const project = url.searchParams.get("project")
  const category = url.searchParams.get("category")

  if (!expense && !project) {
    return new Response("expense 또는 project 를 지정할 것", { status: 400 })
  }

  let q = db.from("project_evidence_files").select("*")
  if (expense) q = q.eq("집행_id", Number(expense))
  else {
    q = q.eq("과제_id", Number(project))
    if (category) q = q.eq("비목_대분류", category)
  }
  const { data, error } = await q
  if (error) return new Response(`목록을 읽지 못했다: ${error.message}`, { status: 500 })

  type Row = {
    파일명: string
    storage_path: string
    비목_대분류: string
    비고: string | null
    업로드일시: string
  }
  const rows = (data ?? []) as Row[]
  if (!rows.length) return new Response("내려받을 증빙이 없다", { status: 404 })

  // 이름은 「요건명_원래파일명」으로 붙인다. 압축을 풀었을 때 무엇의 증빙인지 보여야 한다.
  const names = uniqueNames(
    rows.map((r) => (r.비고 ? `${safe(r.비고)}_${safe(r.파일명)}` : safe(r.파일명))),
  )

  const entries: ZipEntry[] = []
  for (const [i, r] of rows.entries()) {
    const { data: blob, error: dlErr } = await db.storage.from("evidence").download(r.storage_path)
    if (dlErr || !blob) {
      // 한 파일이 없다고 전체를 실패시키지 않는다. 대신 무엇이 빠졌는지 zip 안에 남긴다.
      entries.push({
        name: `없는파일_${names[i]}.txt`,
        data: new TextEncoder().encode(
          `저장소에서 찾지 못했다: ${r.storage_path}\n${dlErr?.message ?? ""}`,
        ),
      })
      continue
    }
    entries.push({
      name: names[i],
      data: new Uint8Array(await blob.arrayBuffer()),
      date: new Date(r.업로드일시),
    })
  }

  const zip = makeZip(entries)
  const label = expense ? `집행${expense}` : `과제${project}${category ? `_${category}` : ""}`
  const filename = `증빙_${label}_${new Date().toISOString().slice(0, 10)}.zip`

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      // 한글 파일명은 filename* (RFC 5987) 로 준다. filename= 만 주면 브라우저가 깨진 이름을 쓴다.
      "Content-Disposition": `attachment; filename="evidence.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  })
}
