import { db } from "@/lib/db"
import { makeXlsx, S, type Cell } from "@/lib/xlsx"
import { 총액, 급여총액, type PersonnelRow } from "@/lib/personnel"

/**
 * 개인별 인건비 계상표 엑셀 — `/api/personnel/xlsx?project=13&year=1`
 *
 * **사용자가 준 실제 양식 그대로 만든다.** 한 사람이 두 줄이고, 자격·구분·재원구분·총액·급여총액은
 * 그 두 줄에 걸쳐 세로로 병합된다. 위 두 줄은 머리글이고 역시 병합된다.
 *
 * ⚠ 원 양식의 그 칸 이름은 「지급구분」(지급/미지급)이지만, 화면 입력에서 그 구분을 없앴다
 *   (2026-09-04 사용자 지시 — db/107). 같은 자리에 **재원구분(현금/현물)** 값을 그대로 낸다 —
 *   현금·현물 서식이 지급·미지급과 1:1로 맞았던 값이라 칸 위치는 그대로 두고 값만 바꿨다.
 *
 *   자격 | 구분(내외부) | 성명        | 소속기관명 | 직급(직위) | 신규채용여부 | 참여시작일  | 참여종료일   | 재원구분 | 총액 | 급여 총액
 *        |              | 연구자등록번호 | 소속부서명 | 국적       | 월급여       | 참여율(%)  | 참여개월수   |
 *
 * 왜 서버에서 만드나: 화면 상태가 아니라 **저장된 값**을 내려야 한다. 저장 안 한 편집분이
 * 엑셀로 나가면 그 파일과 DB 가 어긋나고, 그 파일은 협약서 부속으로 제출된다.
 */

export const dynamic = "force-dynamic"

const 날짜 = (s: string | null) => (s ? s.slice(0, 10) : "")

export async function GET(req: Request) {
  const url = new URL(req.url)
  const project = Number(url.searchParams.get("project"))
  const yearRaw = url.searchParams.get("year")
  const year = yearRaw ? Number(yearRaw) : null

  if (!Number.isInteger(project) || project <= 0) {
    return new Response("project 를 지정할 것", { status: 400 })
  }

  const [{ data: pj }, { data, error }] = await Promise.all([
    db.from("projects").select("*").eq("id", project).limit(1),
    db.from("personnel_costs").select("*").eq("과제_id", project).order("연차").order("정렬"),
  ])
  if (error) return new Response(`인건비를 읽지 못했다: ${error.message}`, { status: 500 })

  const 과제 = (pj ?? [])[0] as { 과제코드?: string; 과제명?: string } | undefined
  const all = (data ?? []) as unknown as PersonnelRow[]
  const rows = year == null ? all : all.filter((r) => Number(r.연차) === year)
  if (!rows.length) {
    return new Response(
      `내려받을 인건비가 없다 (과제 ${project}${year ? ` · ${year}차년도` : ""})`,
      { status: 404 },
    )
  }

  // ── 머리글 두 줄 (병합은 아래 merges 에서) ────────────────────────────────
  const H = (v: string): Cell => ({ v, s: S.머리 })
  const sheet: Cell[][] = [
    [
      H("자격"),
      H("구분\n(내외부)"),
      H("성명"),
      H("소속기관명"),
      H("직급(직위)"),
      H("신규채용여부"),
      H("참여시작일"),
      H("참여종료일"),
      H("재원구분"),
      H("총액"),
      H("급여 총액"),
    ],
    [
      null,
      null,
      H("연구자등록번호"),
      H("소속부서명"),
      H("국적"),
      H("월급여"),
      H("참여율(%)"),
      H("참여개월수"),
      null,
      null,
      null,
    ],
  ]
  const merges = ["A1:A2", "B1:B2", "I1:I2", "J1:J2", "K1:K2"]

  // ── 사람마다 두 줄 ────────────────────────────────────────────────────────
  let r = 3
  for (const p of rows) {
    sheet.push([
      { v: p.자격 ?? "", s: S.가운데 },
      { v: p.내외부, s: S.가운데 },
      { v: p.표시명, s: S.가운데 },
      { v: p.소속기관 ?? "", s: S.글자 },
      { v: p.직급 ?? "", s: S.가운데 },
      { v: p.신규채용여부 ? "신규" : "", s: S.가운데 },
      { v: 날짜(p.참여시작일), s: S.가운데 },
      { v: 날짜(p.참여종료일), s: S.가운데 },
      { v: p.재원구분, s: S.가운데 },
      { v: 총액(p), s: S.숫자 },
      { v: 급여총액(p), s: S.숫자 },
    ])
    sheet.push([
      null,
      null,
      { v: p.연구자등록번호 ?? "", s: S.가운데 },
      { v: p.소속부서 ?? "", s: S.글자 },
      { v: p.국적 ?? "", s: S.가운데 },
      { v: Number(p.월급여) || 0, s: S.숫자 },
      { v: Number(p.참여율) || 0, s: S.가운데 },
      { v: Number(p.참여개월수) || 0, s: S.가운데 },
      null,
      null,
      null,
    ])
    for (const c of ["A", "B", "I", "J", "K"]) merges.push(`${c}${r}:${c}${r + 1}`)
    r += 2
  }

  // ── 합계 — 재원별로 나눠 적는다. RCMS 는 현금과 현물을 따로 넣는다 ────────
  const 합 = { 현금: 0, 현물: 0 } as Record<string, number>
  for (const p of rows) 합[p.재원구분] = (합[p.재원구분] ?? 0) + 총액(p)
  const 총합 = Object.values(합).reduce((a, b) => a + b, 0)

  sheet.push([
    { v: "합계", s: S.머리 },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { v: 총합, s: S.숫자 },
    null,
  ])
  merges.push(`A${r}:I${r}`)
  r += 1
  for (const [재원, 액] of Object.entries(합)) {
    if (!액) continue
    sheet.push([
      { v: `${재원} 소계`, s: S.글자 },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { v: 액, s: S.숫자 },
      null,
    ])
    merges.push(`A${r}:I${r}`)
    r += 1
  }

  // 근거를 파일 안에 남긴다 — 이 표가 어디서 나왔는지 파일만 봐도 알 수 있어야 한다.
  sheet.push([])
  sheet.push([
    {
      v:
        `${과제?.과제코드 ?? `과제 ${project}`} ${과제?.과제명 ?? ""}` +
        `${year ? ` · ${year}차년도` : " · 전체 연차"}` +
        ` · 총액 = 월급여 × 참여율 × 참여개월수 · 급여 총액 = 월급여 × 12` +
        ` · 재원구분 = 현금(급여이체) 또는 현물(기관부담) · 내려받은 시각 ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    },
  ])

  const xlsx = makeXlsx({
    name: year ? `${year}차년도 인건비` : "인건비 계상",
    rows: sheet,
    merges,
    widths: [10, 9, 14, 13, 11, 12, 13, 12, 10, 14, 14],
    freezeRows: 2,
  })

  const 파일명 = `인건비계상_${과제?.과제코드 ?? project}${year ? `_${year}차년도` : ""}_${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`

  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 한글 파일명은 filename* 로 준다. filename= 만 주면 브라우저가 깨진 이름을 쓴다.
      "Content-Disposition": `attachment; filename="personnel.xlsx"; filename*=UTF-8''${encodeURIComponent(파일명)}`,
      "Content-Length": String(xlsx.length),
      "Cache-Control": "no-store",
    },
  })
}
