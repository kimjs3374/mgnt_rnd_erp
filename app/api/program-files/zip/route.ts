import { db } from "@/lib/db"
import { makeZip, uniqueNames, type ZipEntry } from "@/lib/zip"

/**
 * 지원사업 서류함 **한 번에 내려받기** — `/api/program-files/zip?from=2026-01-01&to=2026-09-04&project=2`
 * (2026-09-04 사용자 지시: "한번에 모아서 다운 및 특정 기간을 지정해 볼 수 있으면 좋겠어")
 *
 * 세 표에 흩어진 파일을 **사업별 폴더**로 묶어 하나의 zip 으로 흘려보낸다:
 *     지원사업명/계상 증빙_연구시설·장비 및 재료비_견적서.pdf
 *
 * 왜 라우트 핸들러인가: 서버 액션은 바이너리에 맞지 않다(직렬화를 거친다).
 * 서명 URL 을 여러 개 던지지도 않는다 — 팝업 차단에 걸리고, 사람이 받아야 하는 건 **한 묶음**이다.
 * (`app/api/evidence/zip/route.ts` 와 같은 방식이고, 같은 `lib/zip.ts` 를 쓴다.)
 *
 * ⚠ 한 파일을 못 받아도 **전체를 실패시키지 않는다.** 무엇이 빠졌는지 zip 안에 남긴다 —
 *   서류 40개를 받다가 하나 때문에 전부 못 받는 게 제일 나쁘다.
 */

export const dynamic = "force-dynamic"

/** 파일·폴더 이름에 쓸 수 없는 문자만 걷어낸다. 한글은 그대로 둔다(zip 이 UTF-8 플래그를 세운다). */
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)

type 모음 = {
  과제_id: number
  과제명: string
  출처: string
  분류: string
  파일명: string
  path: string
  일시: string
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get("from") // YYYY-MM-DD, 업로드 시각 기준
  const to = url.searchParams.get("to")
  const project = url.searchParams.get("project") // 특정 사업만
  // 화면에서 출처를 걸러 놓았으면 **받는 것도 같아야 한다.** 보이는 것과 받는 것이
  // 다르면 사람은 zip 을 열어 보고 나서야 안다.
  const sources = url.searchParams.get("sources")
  const 출처걸림 = sources ? new Set(sources.split(",").filter(Boolean)) : null

  const [과제, 계상, 정산, 집행증빙, 집행, 비목] = await Promise.all([
    db.from("projects").select("*"),
    db.from("project_evidence_files").select("*"),
    db.from("settlement_documents").select("*"),
    db.from("evidence").select("*"),
    db.from("expenses").select("*"),
    db.from("categories").select("*"),
  ])
  const 오류 = 과제.error ?? 계상.error ?? 정산.error ?? 집행증빙.error ?? 집행.error ?? 비목.error
  if (오류) return new Response(`목록을 읽지 못했다: ${오류.message}`, { status: 500 })

  const 이름 = new Map((과제.data ?? []).map((p: any) => [Number(p.id), String(p.과제명)]))
  const 비목이름 = new Map((비목.data ?? []).map((c: any) => [String(c.코드), String(c.이름)]))
  const 집행의과제 = new Map((집행.data ?? []).map((e: any) => [Number(e.id), e.과제_id]))

  const rows: 모음[] = []
  for (const r of (계상.data ?? []) as any[]) {
    rows.push({
      과제_id: Number(r.과제_id),
      과제명: 이름.get(Number(r.과제_id)) ?? `과제 ${r.과제_id}`,
      출처: "계상 증빙",
      분류: 비목이름.get(String(r.비목_대분류)) ?? String(r.비목_대분류),
      파일명: String(r.파일명),
      path: String(r.storage_path),
      일시: String(r.업로드일시),
    })
  }
  for (const r of (정산.data ?? []) as any[]) {
    rows.push({
      과제_id: Number(r.과제_id),
      과제명: 이름.get(Number(r.과제_id)) ?? `과제 ${r.과제_id}`,
      출처: "정산 서류",
      분류: String(r.서류종류 ?? "기타"),
      파일명: String(r.파일명),
      path: String(r.storage_path),
      일시: String(r.업로드일시),
    })
  }
  for (const r of (집행증빙.data ?? []) as any[]) {
    const pid = 집행의과제.get(Number(r.expense_id))
    if (!pid || !r.storage_path) continue // 과제 미지정·확정 전 파일은 사업 폴더에 넣지 않는다
    rows.push({
      과제_id: Number(pid),
      과제명: 이름.get(Number(pid)) ?? `과제 ${pid}`,
      출처: "집행 증빙",
      분류: String(r.서류종류 ?? "증빙"),
      파일명: String(r.파일명),
      path: String(r.storage_path),
      일시: String(r.created_at),
    })
  }

  const 걸린것 = rows.filter((r) => {
    const d = r.일시.slice(0, 10)
    if (from && d < from) return false
    if (to && d > to) return false
    if (project && r.과제_id !== Number(project)) return false
    if (출처걸림 && !출처걸림.has(r.출처)) return false
    return true
  })

  if (!걸린것.length) {
    return new Response("그 조건에 내려받을 서류가 없다", { status: 404 })
  }

  // 사업별 폴더로 묶는다 — 압축을 풀었을 때 어느 사업 것인지가 폴더로 보여야 한다.
  //
  // ⚠ `uniqueNames()` 에 **폴더까지 붙인 이름을 넘기면 안 된다.** 그 함수는 `/` 를 `_` 로
  //   바꾼다(파일명 하나를 다듬는 용도라서 그렇다). 실제로 그렇게 넣었더니 폴더가 사라지고
  //   `사업명_계상 증빙_….pdf` 한 줄로 납작해졌다. 그래서 **잎 이름만** 다듬어 겹침을 벌리고,
  //   폴더는 그 뒤에 붙인다. 겹침은 **폴더 안에서만** 따진다 — 사업이 다른데 파일명이 같다고
  //   「(2)」가 붙으면 원래 이름이 아니게 된다.
  const 폴더별 = new Map<string, number[]>()
  걸린것.forEach((r, i) => {
    const f = safe(r.과제명) || "사업미지정"
    폴더별.set(f, [...(폴더별.get(f) ?? []), i])
  })
  const names: string[] = new Array(걸린것.length)
  for (const [폴더, idxs] of 폴더별) {
    const 잎 = uniqueNames(
      idxs.map((i) => `${safe(걸린것[i].출처)}_${safe(걸린것[i].분류)}_${safe(걸린것[i].파일명)}`),
    )
    idxs.forEach((i, k) => {
      names[i] = `${폴더}/${잎[k]}`
    })
  }

  const entries: ZipEntry[] = []
  for (const [i, r] of 걸린것.entries()) {
    const { data: blob, error } = await db.storage.from("evidence").download(r.path)
    if (error || !blob) {
      // 하나가 없다고 전체를 실패시키지 않는다. 무엇이 빠졌는지 zip 안에 남긴다.
      entries.push({
        name: `${names[i]}.없는파일.txt`,
        data: new TextEncoder().encode(
          `저장소에서 찾지 못했다: ${r.path}\n${error?.message ?? ""}`,
        ),
      })
      continue
    }
    entries.push({
      name: names[i],
      data: new Uint8Array(await blob.arrayBuffer()),
      date: new Date(r.일시),
    })
  }

  const zip = makeZip(entries)
  const 기간 = from || to ? `_${from || "처음"}~${to || "지금"}` : ""
  const 대상 = project ? `_${safe(이름.get(Number(project)) ?? `과제${project}`)}` : ""
  const filename = `지원사업서류함${대상}${기간}_${new Date().toISOString().slice(0, 10)}.zip`

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      // 한글 파일명은 filename*(RFC 5987) 로 준다. filename= 만 주면 브라우저가 깨진 이름을 쓴다.
      "Content-Disposition": `attachment; filename="program-files.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  })
}
