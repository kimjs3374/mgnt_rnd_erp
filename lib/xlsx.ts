/**
 * 최소 xlsx 쓰기 — **의존성 0개.** `lib/zip.ts`(store 방식) 위에 얹었다.
 *
 * 왜 CSV 가 아닌가: 인건비 계상표는 **한 사람이 두 줄**이고 자격·지급구분·총액이 세로로 병합돼 있다.
 * CSV 로 내리면 그 모양이 사라져서 담당자가 쓰던 양식과 대조할 수 없다.
 * xlsx 는 zip + XML 몇 장이라 병합·서식까지 그대로 만들 수 있다.
 *
 * 왜 라이브러리를 안 쓰나: 스택 고정(CLAUDE.md §7)과, 마감 전날 `npm install` 이
 * 공용 dev 서버 재시작을 부르기 때문이다. 필요한 기능은 문자열·숫자·병합·열너비·테두리뿐이다.
 *
 * 지원하는 것 — 시트 1장 · inlineStr/숫자 · 병합 · 열 너비 · 스타일 5종(아래 S).
 * 지원하지 않는 것 — 수식 · 여러 시트 · 이미지 · 조건부 서식. 필요해지면 그때 늘린다.
 */
import { makeZip, type ZipEntry } from "@/lib/zip"

/** 스타일 번호. cellXfs 의 순서와 같아야 한다. */
export const S = {
  기본: 0,
  머리: 1, // 굵게 · 가운데 · 회색 배경 · 테두리
  글자: 2, // 테두리
  숫자: 3, // 테두리 · #,##0
  가운데: 4, // 테두리 · 가운데
} as const

export type Cell =
  | { v: string | number | null; s?: number }
  | string
  | number
  | null
  | undefined

/** A1 표기. 열 26개를 넘으면 AA 로 넘어간다. */
export function colName(i: number): string {
  let s = ""
  let n = i
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // 엑셀이 거부하는 제어문자를 걷어낸다(붙여넣기 데이터에 섞여 들어온다).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
function cellXml(ref: string, c: Cell): string {
  if (c == null || c === "") return ""
  const obj = typeof c === "object" ? c : { v: c, s: undefined as number | undefined }
  if (obj.v == null || obj.v === "") {
    return obj.s ? `<c r="${ref}" s="${obj.s}"/>` : ""
  }
  const s = obj.s ? ` s="${obj.s}"` : ""
  if (typeof obj.v === "number" && Number.isFinite(obj.v)) {
    return `<c r="${ref}"${s}><v>${obj.v}</v></c>`
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(obj.v))}</t></is></c>`
}

export type SheetSpec = {
  name?: string
  rows: Cell[][]
  /** `A1:B2` 형식. 병합은 왼쪽 위 칸에만 값을 넣는다. */
  merges?: string[]
  /** 열 너비(문자 수). 비우면 기본값. */
  widths?: number[]
  /** 고정할 행 수(머리글). 2 면 두 줄이 얼어붙는다. */
  freezeRows?: number
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function sheetXml(spec: SheetSpec): string {
  const rows = spec.rows
  const 마지막열 = Math.max(1, ...rows.map((r) => r.length))
  const dim = `A1:${colName(마지막열 - 1)}${Math.max(1, rows.length)}`

  const cols = spec.widths?.length
    ? `<cols>${spec.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : ""

  const pane = spec.freezeRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${spec.freezeRows}" topLeftCell="A${
        spec.freezeRows + 1
      }" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : ""

  const sheetData = rows
    .map((r, ri) => {
      const cells = r.map((c, ci) => cellXml(`${colName(ci)}${ri + 1}`, c)).join("")
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join("")

  // ⚠ mergeCells 는 sheetData **뒤에** 와야 한다. 순서가 틀리면 엑셀이 「복구」를 띄운다.
  const merges = spec.merges?.length
    ? `<mergeCells count="${spec.merges.length}">${spec.merges
        .map((m) => `<mergeCell ref="${m}"/>`)
        .join("")}</mergeCells>`
    : ""

  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/>${pane}${cols}<sheetData>${sheetData}</sheetData>${merges}</worksheet>`
}

const stylesXml = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** 시트 하나짜리 xlsx 바이트. 그대로 응답 본문에 실으면 된다. */
export function makeXlsx(spec: SheetSpec): Uint8Array {
  const name = (spec.name ?? "Sheet1").replace(/[\\/?*[\]:]/g, "_").slice(0, 31)
  const enc = new TextEncoder()
  const files: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    { name: "xl/styles.xml", data: enc.encode(stylesXml) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(spec)) },
  ]
  return makeZip(files)
}
