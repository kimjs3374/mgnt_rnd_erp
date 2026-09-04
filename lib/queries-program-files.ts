import "server-only"
import { db, safeSelect } from "@/lib/db"
import { 서류함에담나 } from "@/lib/program-file-types"
import type { 사업파일, 서류함스코프, 보류증빙 } from "@/lib/program-file-types"

/**
 * 사업 **서류함** — 한 사업에 붙은 파일을 세 곳에서 모아 한 목록으로 만든다.
 * 지원사업 서류함(`/programs/files`)과 과제사업 서류함(`/projects/files`)이 같이 쓴다
 * (2026-09-04) — `getProgramFiles(과제사업만)` 인자로 어느 쪽 과제까지 셀지만 가른다.
 *
 * 파일이 세 표에 흩어져 있다. 각각 붙는 자리가 달라서 그렇게 나뉘었고, 그건 그대로 둔다 —
 * 대신 **보는 자리 하나**를 만든다(2026-09-04 사용자 지시).
 *   · `project_evidence_files` 계상 탭에서 붙인 비목별 증빙 (과제_id 직결)
 *   · `evidence`               집행 건에 붙은 증빙 (expense → 과제)
 *   · `settlement_documents`   최종 정산 서류 (과제_id 직결, db/110)
 *
 * ⚠ 업체 서류(`vendor_documents`)와 회사 서류함(`documents`)은 **여기 없다.**
 *   그건 사업에 붙는 것이 아니라 업체·회사에 붙는다 — 한 사업 폴더에 넣으면
 *   「이 사업 서류」라는 말이 거짓이 된다. 규정 문서함(`rule_documents`)도 우리가 **받는** 것이라 뺀다.
 *
 * ⚠ `select("컬럼명")` 로 추리지 않는다 — supabase-js 타입 파서가 한글 식별자에서 막힌다.
 */

type 과제Raw = { id: number; 과제명: string; 사업유형: string | null; 선정결과: string | null }
type 계상Raw = {
  id: number
  과제_id: number
  비목_대분류: string
  파일명: string
  크기: number | null
  업로더: string | null
  업로드일시: string
}
type 정산Raw = {
  id: number
  과제_id: number
  서류종류: string
  파일명: string
  크기: number | null
  업로더: string | null
  업로드일시: string
}
type 집행증빙Raw = {
  id: number
  expense_id: number
  파일명: string
  서류종류: string | null
  storage_path: string | null
  bytes: number | null
  created_at: string
}
type 집행Raw = { id: number; 과제_id: number | null }
type 비목Raw = { 코드: string; 이름: string }

export type 서류함결과 = { 파일: 사업파일[]; 보류: 보류증빙[]; error: string | null }

/**
 * 파일 전부를 **한 목록**으로 돌려준다. 거르는 일도, 사업별로 묶는 일도 화면이 한다
 * (`묶기()`) — 기간·출처를 거르면 묶음이 달라지는데 서버가 미리 묶어 두면
 * 「이 사업 3건」이 눈앞의 목록과 어긋난다.
 *
 * 정렬은 **최근 넣은 것이 위**다. 서류함에서 찾는 건 대개 방금 넣은 파일이다.
 *
 * @param 스코프 지원사업 서류함(`/programs/files`)과 과제사업 서류함(`/projects/files`)이
 *   같은 조회·같은 화면(`ProgramFiles`)을 쓴다 — 파일 세 표(계상·정산·집행증빙)의 모양이
 *   사업유형과 무관하게 똑같기 때문이다. 다른 건 **어느 사업까지 셀지**뿐이고, 그 판별은
 *   `서류함에담나()` 한 군데에 있다(zip 라우트도 같은 것을 쓴다).
 */
export async function getProgramFiles(스코프: 서류함스코프): Promise<서류함결과> {
  const [과제, 계상, 정산, 집행증빙, 집행, 비목] = await Promise.all([
    safeSelect<과제Raw>("projects", () => db.from("projects").select("*")),
    safeSelect<계상Raw>("project_evidence_files", () =>
      db.from("project_evidence_files").select("*"),
    ),
    safeSelect<정산Raw>("settlement_documents", () => db.from("settlement_documents").select("*")),
    safeSelect<집행증빙Raw>("evidence", () => db.from("evidence").select("*")),
    safeSelect<집행Raw>("expenses", () => db.from("expenses").select("*")),
    safeSelect<비목Raw>("categories", () => db.from("categories").select("*")),
  ])
  const error =
    과제.error ?? 계상.error ?? 정산.error ?? 집행증빙.error ?? 집행.error ?? 비목.error ?? null
  if (error) return { 파일: [], 보류: [], error }

  const 허용된과제 = 과제.rows.filter((p) => 서류함에담나(p, 스코프))
  const 허용됨 = new Set(허용된과제.map((p) => Number(p.id)))

  const 이름 = new Map(허용된과제.map((p) => [Number(p.id), p.과제명]))
  const 비목이름 = new Map(비목.rows.map((c) => [c.코드, c.이름]))
  const 집행의과제 = new Map(집행.rows.map((e) => [Number(e.id), e.과제_id]))

  const 전체: 사업파일[] = []
  /** 담지 못한 것. 빼는 것과 **빼놓고 말 안 하는 것**은 다르다. */
  const 보류: 보류증빙[] = []

  for (const r of 계상.rows) {
    if (!허용됨.has(Number(r.과제_id))) continue
    전체.push({
      키: `계상:${r.id}`,
      출처: "계상 증빙",
      id: Number(r.id),
      과제_id: Number(r.과제_id),
      과제명: 이름.get(Number(r.과제_id)) ?? `과제 ${r.과제_id}`,
      파일명: r.파일명,
      분류: 비목이름.get(r.비목_대분류) ?? r.비목_대분류,
      크기: r.크기 == null ? null : Number(r.크기),
      일시: r.업로드일시,
      업로더: r.업로더 ?? null,
    })
  }

  for (const r of 정산.rows) {
    if (!허용됨.has(Number(r.과제_id))) continue
    전체.push({
      키: `정산:${r.id}`,
      출처: "정산 서류",
      id: Number(r.id),
      과제_id: Number(r.과제_id),
      과제명: 이름.get(Number(r.과제_id)) ?? `과제 ${r.과제_id}`,
      파일명: r.파일명,
      분류: r.서류종류,
      크기: r.크기 == null ? null : Number(r.크기),
      일시: r.업로드일시,
      업로더: r.업로더 ?? null,
    })
  }

  for (const r of 집행증빙.rows) {
    // ⚠ Slack 으로 막 들어온 건은 **아직 과제가 안 정해졌을 수 있다.** 그런 파일은
    //   어느 사업 폴더에도 넣지 않는다 — 짐작해 넣으면 그 사업 서류가 아닌 것이 섞인다.
    const pid = 집행의과제.get(Number(r.expense_id))
    if (!pid) continue
    if (!허용됨.has(Number(pid))) continue
    // 확정 전 파일은 storage_path 가 비어 있다(「검토대기」 — 스테이징에만 있다).
    // 내려받을 수 없으니 뺀다. **다만 세어 둔다** — 조용히 빠지면 「집행엔 있는데
    // 서류함엔 없다」가 되고, 사람은 시스템이 파일을 잃었다고 생각한다.
    if (!r.storage_path) {
      보류.push({
        집행_id: Number(r.expense_id),
        과제_id: Number(pid),
        과제명: 이름.get(Number(pid)) ?? `과제 ${pid}`,
        파일명: r.파일명,
      })
      continue
    }
    전체.push({
      키: `집행:${r.id}`,
      출처: "집행 증빙",
      id: Number(r.id),
      과제_id: Number(pid),
      과제명: 이름.get(Number(pid)) ?? `과제 ${pid}`,
      파일명: r.파일명,
      분류: r.서류종류 ?? "증빙",
      크기: r.bytes == null ? null : Number(r.bytes),
      일시: r.created_at,
      업로더: null,
    })
  }

  전체.sort((a, b) => String(b.일시).localeCompare(String(a.일시)))
  보류.sort((a, b) => a.과제명.localeCompare(b.과제명) || a.집행_id - b.집행_id)
  return { 파일: 전체, 보류, error: null }
}
