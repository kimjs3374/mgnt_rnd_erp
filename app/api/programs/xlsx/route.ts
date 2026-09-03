import { getLedger } from "@/lib/queries"
import { makeXlsx, S, type Cell } from "@/lib/xlsx"

/**
 * 지원사업 대장 엑셀 — `/api/programs/xlsx`
 *
 * 화면에 보이는 대장 표를 그대로 내려받는다. 케이오시가 엑셀로 관리하던 그 표를
 * 대체하는 화면이라, 「엑셀로 다시 뽑을 수 있다」가 곧 교체 가능성의 증거다.
 *
 * ⚠ `비고`는 담당자 실명·내부 협의 내용이 섞여 있어(CLAUDE.md §0.5 「제공데이터의 오류가
 * 곧 시연 소재다」) 화면에도 안 보여주는 컬럼이다. 여기서도 넣지 않는다.
 */
export const dynamic = "force-dynamic"

const 날짜 = (s: string | null) => (s ? s.slice(0, 10) : "")

export async function GET() {
  const { rows, error } = await getLedger()
  if (error) return new Response(`대장을 읽지 못했다: ${error}`, { status: 500 })
  if (!rows.length) return new Response("내려받을 사업이 없다", { status: 404 })

  const H = (v: string): Cell => ({ v, s: S.머리 })
  const sheet: Cell[][] = [
    [
      H("사업명"),
      H("기관"),
      H("유형"),
      H("마감일"),
      H("지원금액"),
      H("사용금액"),
      H("결과"),
      H("상태"),
      H("미처리점검"),
      H("미확보서류"),
    ],
  ]

  for (const r of rows) {
    sheet.push([
      { v: r.사업명, s: S.글자 },
      { v: r.기관 ?? "", s: S.글자 },
      { v: r.사업유형 ?? "", s: S.글자 },
      { v: 날짜(r.마감일), s: S.가운데 },
      { v: Number(r.지원금액) || 0, s: S.숫자 },
      { v: Number(r.사용금액) || 0, s: S.숫자 },
      { v: r.선정결과 ?? "", s: S.가운데 },
      { v: r.상태, s: S.가운데 },
      { v: r.미처리점검, s: S.가운데 },
      { v: r.미확보서류, s: S.가운데 },
    ])
  }

  sheet.push([])
  sheet.push([
    {
      v: `지원사업 대장 · ${rows.length}건 · 내려받은 시각 ${new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")} UTC`,
    },
  ])

  const xlsx = makeXlsx({
    name: "지원사업 대장",
    rows: sheet,
    widths: [26, 16, 12, 11, 14, 14, 9, 9, 10, 10],
    freezeRows: 1,
  })

  const 파일명 = `지원사업대장_${new Date().toISOString().slice(0, 10)}.xlsx`

  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 한글 파일명은 filename* 로 준다. filename= 만 주면 브라우저가 깨진 이름을 쓴다.
      "Content-Disposition": `attachment; filename="programs.xlsx"; filename*=UTF-8''${encodeURIComponent(파일명)}`,
      "Content-Length": String(xlsx.length),
      "Cache-Control": "no-store",
    },
  })
}
