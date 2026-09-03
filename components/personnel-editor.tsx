"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/money-input"
import {
  savePersonnelRows,
  deletePersonnelRow,
} from "@/app/actions/personnel"
import { 총액, 급여총액, 재원별합계, 참여율초과, type PersonnelRow } from "@/lib/personnel"
import { 참여종료일계산 } from "@/lib/participation"

/**
 * 개인별 인건비 계상 — 연차별로 사람마다 한 줄.
 *
 * 실제 양식(연구개발계획서 인건비 계상표)의 열을 그대로 옮겼다.
 * 총액 = 월급여 × 참여율 × 참여개월수 는 **치는 즉시 다시 계산**된다 — 사람이 계산기를 두 번
 * 두드리지 않게. 그리고 그 합계를 「연구비 계상」의 인건비 줄로 그대로 보낸다(현금·현물로 나눠서).
 *
 * ⚠ 「지급구분」(지급/미지급)은 없다(2026-09-04 사용자 지시로 폐지 — db/107). 재원구분을
 *   현금·현물 중에서 바로 고른다. "정부출연금으로 직접 지급"하는 예외는 여기서 가르지 않고
 *   연구비 계상(BudgetEditor)의 PERSONNEL 줄에서 재원(출연금·현금·현물)을 다시 정한다.
 *
 * ⚠ 실명·실제 급여를 공개 URL 에 올리지 않는다(CLAUDE.md §5 절대규칙 5).
 *   대회 기간에는 표시명에 가명을 쓴다. 화면에도 그 문구를 띄운다.
 */

const won = (n: number) => Math.round(n).toLocaleString("ko-KR")

type Draft = Omit<PersonnelRow, "id"> & { id: number | null; _새것?: boolean }

const 빈줄 = (연차: number, 정렬: number): Draft => ({
  id: null,
  연차,
  정렬,
  자격: "",
  내외부: "내부",
  표시명: "",
  연구자등록번호: null,
  소속기관: null,
  소속부서: null,
  직급: "",
  국적: null,
  신규채용여부: false,
  월급여: 0,
  참여율: 0,
  참여개월수: 0,
  참여시작일: null,
  참여종료일: null,
  재원구분: "현물",
  비고: null,
  _새것: true,
})

export function PersonnelEditor({
  과제_id,
  초기값,
  협약연수,
  연차연도 = [],
  명부 = [],
  읽기전용 = false,
}: {
  과제_id: number
  초기값: PersonnelRow[]
  /**
   * 협약이 걸친 **연차 개수**. 기간을 12로 나눈 값이 아니다 —
   * 2022-06-01~2024-05-31 은 기간 2년이지만 3개 연차다(`lib/fiscal-year.ts`).
   * 탭을 강제하지 않고 안내만 한다(사용자 지시: 기본 1차년도).
   */
  협약연수: number
  /** 그 연차들이 각각 몇 년도인가. `[2022, 2023, 2024]` — 탭에 붙여서 오해를 없앤다. */
  연차연도?: number[]
  /**
   * 내부 연구원 명부(`db/105_researchers.sql`). 골라서 한 줄 넣는 데 쓴다.
   * ⚠ **값을 복사해 넣는다. 참조하지 않는다** — 계상은 그때의 연봉으로 확정된 기록이라
   *   나중에 명부의 연봉이 바뀌어도 지난 계상이 따라 움직이면 안 된다.
   */
  명부?: {
    id: number
    표시명: string
    연구자등록번호: string | null
    소속기관: string | null
    소속부서: string | null
    직급: string | null
    국적: string | null
    내외부: string
    연봉: number
  }[]
  /**
   * 계상이 확정된 과제 — 인건비 산출도 계상의 일부라 같이 잠긴다.
   * **표와 엑셀 다운로드는 그대로 둔다.** 확정된 내역을 못 보거나 못 받으면 곤란하다.
   */
  읽기전용?: boolean
}) {
  // **기본은 1차년도 하나뿐이고, 필요할 때 「+ 연차 추가」로 늘린다.**
  // 협약이 2년이라도 1차년도만 계상하고 넘어가는 경우가 흔해서, 빈 탭을 미리 벌려두면
  // 「2차년도가 비어 있다」는 잘못된 인상을 준다.
  const [최대연차, set최대연차] = React.useState(() =>
    Math.max(1, ...초기값.map((r) => Number(r.연차) || 1)),
  )
  const 연차목록 = Array.from({ length: 최대연차 }, (_, i) => i + 1)
  const [연차, set연차] = React.useState(1)
  const [rows, setRows] = React.useState<Draft[]>(초기값.map((r) => ({ ...r })))
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [상세, set상세] = React.useState(false)
  const [pending, start] = React.useTransition()

  React.useEffect(() => setRows(초기값.map((r) => ({ ...r }))), [초기값])

  const 보이는 = rows.filter((r) => Number(r.연차) === 연차)
  const 더러움 = JSON.stringify(rows) !== JSON.stringify(초기값.map((r) => ({ ...r })))
  const 합 = 재원별합계(rows as PersonnelRow[], 연차)
  const 총합 = 합.출연금 + 합.현금 + 합.현물
  const 초과 = 참여율초과(rows as PersonnelRow[], 연차)

  const 수정 = (row: Draft, patch: Partial<Draft>) =>
    setRows((prev) => prev.map((r) => (r === row ? { ...r, ...patch } : r)))

  function 줄추가() {
    setRows((prev) => [...prev, 빈줄(연차, prev.length)])
  }

  /**
   * 명부에서 골라 한 줄 넣는다(2026-09-04 사용자 지시).
   *
   * 이름·연구자등록번호·부서·직급·**월급여(연봉÷12)** 를 채워 준다.
   * 참여율·참여개월수는 **비워 둔다** — 과제마다 다른 값이고, 명부가 알 수 있는 것이 아니다.
   * 여기서 짐작해 채우면 사람이 확인 안 하고 넘어가 그대로 협약에 들어간다.
   *
   * ⚠ 명부를 **참조하지 않고 값을 복사한다.** 계상은 그때의 연봉으로 확정된 기록이라,
   *   나중에 명부의 연봉이 바뀌어도 지난 계상이 따라 움직이면 안 된다.
   */
  function 명부에서넣기(id: number) {
    const r = 명부.find((x) => x.id === id)
    if (!r) return
    setMsg(null)
    setRows((prev) => [
      ...prev,
      {
        ...빈줄(연차, prev.length),
        표시명: r.표시명,
        연구자등록번호: r.연구자등록번호 ?? null,
        소속기관: r.소속기관 ?? null,
        소속부서: r.소속부서 ?? null,
        직급: r.직급 ?? null,
        국적: r.국적 ?? null,
        내외부: r.내외부 ?? "내부",
        월급여: Math.floor(Math.max(0, Number(r.연봉 ?? 0)) / 12),
      },
    ])
  }

  function 저장() {
    setMsg(null)
    start(async () => {
      const r = await savePersonnelRows(과제_id, rows as never)
      // 저장이 곧 반영이다(2026-09-04). 얼마가 내려갔는지 말해 줘야 아래 표를 확인하러 간다.
      const 요약 = Object.entries(r.반영 ?? {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v.toLocaleString("ko-KR")}원`)
        .join(" · ")
      setMsg(
        r.ok
          ? {
              ok: true,
              text: 요약
                ? `저장했습니다. 아래 비목 인건비를 ${요약} 으로 맞췄습니다.`
                : "저장했습니다.",
            }
          : { ok: false, text: r.error ?? "저장하지 못했습니다." },
      )
    })
  }

  function 줄삭제(row: Draft) {
    if (row.id == null) {
      setRows((prev) => prev.filter((r) => r !== row))
      return
    }
    setMsg(null)
    start(async () => {
      const r = await deletePersonnelRow(과제_id, row.id as number)
      if (r.ok) setRows((prev) => prev.filter((x) => x !== row))
      else setMsg({ ok: false, text: r.error ?? "지우지 못했습니다." })
    })
  }

  // 손으로 부르던 `반영()` 은 없앴다 — `savePersonnelRows` 가 저장하면서 같이 맞춘다.
  // 서버의 `applyPersonnelToBudget` 은 남겨 뒀다(스크립트·복구용). 화면에서는 안 부른다.

  const cell = "h-7 text-[12.5px]"
  const num = "h-7 text-right text-[12.5px] tabular-nums"

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">개인별 인건비 계상</span>
        <div className="flex flex-wrap gap-1">
          {연차목록.map((y) => {
            const 인원 = rows.filter((r) => Number(r.연차) === y).length
            return (
              <Button
                key={y}
                type="button"
                variant={y === 연차 ? "default" : "outline"}
                className="h-6 px-2 text-[11.5px]"
                onClick={() => set연차(y)}
                title={연차연도[y - 1] ? `${연차연도[y - 1]}년` : undefined}
              >
                {y}차년도
                {연차연도[y - 1] ? (
                  <span className="ml-1 opacity-70">{연차연도[y - 1]}</span>
                ) : null}
                {인원 > 0 ? ` ${인원}` : ""}
              </Button>
            )
          })}
          {/* 협약이 몇 년이든 탭은 1차년도만 열어 둔다. 필요할 때 사람이 늘린다. */}
          <Button
            type="button"
            variant="ghost"
            className="h-6 px-2 text-[11.5px] text-muted-foreground"
            onClick={() => {
              const 다음 = 최대연차 + 1
              set최대연차(다음)
              set연차(다음)
            }}
            title={
              협약연수 > 최대연차
                ? `이 협약은 ${협약연수}개 연차다${
                    연차연도.length ? ` (${연차연도.join(" · ")})` : ""
                  }`
                : undefined
            }
          >
            + 연차 추가
          </Button>
          {협약연수 > 최대연차 && (
            // ⚠ 「협약 2년」이라고 쓰면 안 된다 — 기간과 연차 개수는 다르다.
            //    2022-06~2024-05 는 기간 2년, 연차는 3개다(lib/fiscal-year.ts).
            <span className="self-center text-[11px] text-muted-foreground">
              협약 {협약연수}개 연차
              {연차연도.length ? ` (${연차연도.join(" · ")})` : ""}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {보이는.length}명 · 합계 <span className="tabular-nums">{won(총합)}</span>원
          {합.현금 > 0 && ` (현금 ${won(합.현금)})`}
          {합.현물 > 0 && ` (현물 ${won(합.현물)})`}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto h-6 px-2 text-[12px] text-muted-foreground"
          onClick={() => set상세((v) => !v)}
        >
          {상세 ? "기본 열만" : "상세 열 보기"}
        </Button>
      </div>

      <p className="mb-2 text-[11.5px] text-[var(--warning-fg)]">
        ⚠ 공개 주소에는 실명·실제 급여를 올리지 않습니다. 대회 기간에는 표시명에 가명을 쓰세요 —
        급여이체증·4대보험 명부 업로드도 코드가 막고 있습니다.
      </p>

      {초과.length > 0 && (
        <p className="mb-2 text-[12px] text-destructive">
          참여율 합이 100%를 넘습니다 —{" "}
          {초과.map((x) => `${x.표시명} ${x.합}%`).join(" · ")} (정산에서 걸립니다)
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-[92px] pb-1 font-normal">자격</th>
              <th className="w-[64px] pb-1 font-normal">구분</th>
              <th className="w-[100px] pb-1 font-normal">표시명</th>
              {상세 && <th className="w-[110px] pb-1 font-normal">연구자등록번호</th>}
              {상세 && <th className="w-[110px] pb-1 font-normal">소속/부서</th>}
              <th className="w-[80px] pb-1 font-normal">직급</th>
              <th className="w-[52px] pb-1 text-center font-normal">신규</th>
              <th className="w-[120px] pb-1 text-right font-normal">월급여</th>
              <th className="w-[70px] pb-1 text-right font-normal">참여율%</th>
              <th className="w-[62px] pb-1 text-right font-normal">개월</th>
              <th className="w-[124px] pb-1 font-normal">참여시작</th>
              <th className="w-[124px] pb-1 font-normal">참여종료</th>
              <th className="w-[72px] pb-1 font-normal">재원</th>
              <th className="w-[110px] pb-1 text-right font-normal">총액</th>
              <th className="w-[110px] pb-1 text-right font-normal">급여총액</th>
              <th className="w-[44px] pb-1" />
            </tr>
          </thead>
          <tbody>
            {보이는.length === 0 && (
              <tr>
                {/* 상세 열이 둘(연구자등록번호·소속/부서)이라 16. 열을 더하면 여기도 같이 고친다. */}
                <td colSpan={상세 ? 16 : 14} className="py-8 text-center text-muted-foreground">
                  {연차}차년도에 등록된 인원이 없습니다. 아래 「+ 인원 추가」로 시작하세요.
                </td>
              </tr>
            )}
            {보이는.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className="border-b last:border-0">
                <td className="py-1 pr-1">
                  <Input
                    className={cell}
                    value={r.자격 ?? ""}
                    placeholder="연구책임"
                    onChange={(e) => 수정(r, { 자격: e.target.value })}
                    aria-label="자격"
                  />
                </td>
                <td className="py-1 pr-1">
                  <select
                    className="h-7 w-full rounded-md border bg-transparent px-1 text-[12.5px]"
                    value={r.내외부}
                    onChange={(e) => 수정(r, { 내외부: e.target.value })}
                    aria-label="내외부"
                  >
                    <option value="내부">내부</option>
                    <option value="외부">외부</option>
                  </select>
                </td>
                <td className="py-1 pr-1">
                  <Input
                    className={cell}
                    value={r.표시명}
                    placeholder="연구원A"
                    onChange={(e) => 수정(r, { 표시명: e.target.value })}
                    aria-label="표시명"
                  />
                </td>
                {/* 연구자등록번호 — 계상표 엑셀에 들어가는 값인데 화면에 없어서
                    명부에서 제대로 넘어왔는지 확인할 길이 없었다(2026-09-04). 상세 열로 낸다. */}
                {상세 && (
                  <td className="py-1 pr-1">
                    <Input
                      className={cell}
                      value={r.연구자등록번호 ?? ""}
                      placeholder="R-0000000"
                      onChange={(e) => 수정(r, { 연구자등록번호: e.target.value })}
                      aria-label="연구자등록번호"
                    />
                  </td>
                )}
                {상세 && (
                  <td className="py-1 pr-1">
                    <Input
                      className={cell}
                      value={r.소속부서 ?? ""}
                      onChange={(e) => 수정(r, { 소속부서: e.target.value })}
                      aria-label="소속부서"
                    />
                  </td>
                )}
                <td className="py-1 pr-1">
                  <Input
                    className={cell}
                    value={r.직급 ?? ""}
                    onChange={(e) => 수정(r, { 직급: e.target.value })}
                    aria-label="직급"
                  />
                </td>
                <td className="py-1 pr-1 text-center">
                  <input
                    type="checkbox"
                    checked={r.신규채용여부}
                    onChange={(e) => 수정(r, { 신규채용여부: e.target.checked })}
                    aria-label="신규채용 여부"
                  />
                </td>
                <td className="py-1 pr-1">
                  <MoneyInput
                    value={Number(r.월급여) || 0}
                    onValueChange={(n) => 수정(r, { 월급여: n })}
                    className={num}
                    aria-label="월급여"
                  />
                </td>
                <td className="py-1 pr-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    className={num}
                    value={String(r.참여율 ?? 0)}
                    onChange={(e) => 수정(r, { 참여율: Number(e.target.value) || 0 })}
                    aria-label="참여율"
                  />
                </td>
                <td className="py-1 pr-1">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    className={num}
                    value={String(r.참여개월수 ?? 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value) || 0
                      // 개월수를 고치면 종료일도 따라온다. **직접 넣은 종료일은 덮지 않는다**
                      // (`?? r.참여종료일`) — 계산이 안 되는 값(비정수 개월수)도 그대로 둔다.
                      수정(r, {
                        참여개월수: n,
                        참여종료일: 참여종료일계산(r.참여시작일, n) ?? r.참여종료일,
                      })
                    }}
                    aria-label="참여개월수"
                  />
                </td>
                <td className="py-1 pr-1">
                  <Input
                    type="date"
                    className={cell}
                    value={r.참여시작일 ?? ""}
                    onChange={(e) => {
                      const v = e.target.value || null
                      // 시작일 + 개월수 → 종료일. 종료일 = 시작일 + 개월수 − 1일이다
                      // (2022-06-01 + 24개월 = 2024-05-31 — 과제 13 협약기간과 일치).
                      수정(r, {
                        참여시작일: v,
                        참여종료일: 참여종료일계산(v, r.참여개월수) ?? r.참여종료일,
                      })
                    }}
                    aria-label="참여시작일"
                  />
                </td>
                <td className="py-1 pr-1">
                  <Input
                    type="date"
                    className={cell}
                    value={r.참여종료일 ?? ""}
                    onChange={(e) => 수정(r, { 참여종료일: e.target.value || null })}
                    aria-label="참여종료일"
                  />
                </td>
                <td className="py-1 pr-1">
                  {/* 지급구분(지급/미지급)을 없앴다(db/107) — 현금·현물 둘만 직접 고른다.
                      "출연금은 다 현금"이라 재원 칸에서도 출연금은 빼서 헷갈릴 여지를 줄였다. */}
                  <select
                    className="h-7 w-full rounded-md border bg-transparent px-1 text-[12.5px]"
                    value={r.재원구분}
                    onChange={(e) =>
                      수정(r, { 재원구분: e.target.value as "현금" | "현물" })
                    }
                    aria-label="재원구분"
                  >
                    <option value="현물">현물</option>
                    <option value="현금">현금</option>
                  </select>
                </td>
                <td className="py-1 pr-1 text-right font-medium tabular-nums">
                  {won(총액(r))}
                </td>
                <td className="py-1 pr-1 text-right tabular-nums text-muted-foreground">
                  {won(급여총액(r))}
                </td>
                <td className="py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 px-1.5 text-[11.5px] text-muted-foreground"
                    disabled={pending}
                    onClick={() => 줄삭제(r)}
                  >
                    삭제
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="h-7 text-[12.8px]" onClick={줄추가}>
          + 인원 추가
        </Button>

        {/* 명부에서 골라 넣기(2026-09-04). 사람이 없으면 select 대신 어디서 등록하는지 알려 준다 —
            빈 목록을 띄우면 「고장났나」가 된다. */}
        {!읽기전용 &&
          (명부.length > 0 ? (
            <select
              className="h-7 rounded-md border bg-transparent px-2 text-[12.5px] text-foreground"
              value=""
              aria-label="명부에서 연구원 넣기"
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v) 명부에서넣기(v)
                e.target.value = ""
              }}
            >
              <option value="">명부에서 넣기…</option>
              {명부.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.표시명}
                  {r.직급 ? ` · ${r.직급}` : ""} · 월{" "}
                  {Math.floor(Number(r.연봉 ?? 0) / 12).toLocaleString("ko-KR")}
                </option>
              ))}
            </select>
          ) : (
            <a
              href="/researchers"
              className="text-[11.5px] text-muted-foreground underline underline-offset-2"
            >
              연구원 명부에 등록해 두면 골라 넣을 수 있습니다
            </a>
          ))}
        {/* 엑셀은 **저장된 값**으로 만든다(서버가 DB 를 읽는다). 저장 안 한 편집분이 파일로
            나가면 그 파일과 DB 가 어긋나고, 이 표는 협약서 부속으로 제출된다. */}
        <a
          href={`/api/personnel/xlsx?project=${과제_id}&year=${연차}`}
          className={
            보이는.length === 0 || 더러움
              ? "pointer-events-none rounded-md border px-2 py-1 text-[12.8px] text-muted-foreground opacity-50"
              : "rounded-md border px-2 py-1 text-[12.8px] text-muted-foreground hover:bg-secondary/60"
          }
          title={
            더러움
              ? "저장하지 않은 변경이 있습니다 — 저장 후 내려받으세요"
              : "실제 양식 그대로 엑셀로 내려받습니다"
          }
        >
          엑셀 다운로드 ({연차}차년도)
        </a>
        <a
          href={`/api/personnel/xlsx?project=${과제_id}`}
          className={
            rows.length === 0 || 더러움
              ? "pointer-events-none rounded-md border px-2 py-1 text-[12.8px] text-muted-foreground opacity-50"
              : "rounded-md border px-2 py-1 text-[12.8px] text-muted-foreground hover:bg-secondary/60"
          }
        >
          전체 연차
        </a>
        {/* ⚠ 「인건비 비목으로 반영」 버튼이 여기 있었는데 **뺐다**(2026-09-04 사용자 지시).
            저장하면 저절로 반영된다. 버튼을 남겨 두면 「눌러야 반영되나」로 읽혀서
            안 누른 사람의 비목 인건비가 개인별과 어긋난 채 남는다.
            그 버튼은 **고른 연차만** 반영해서 2년 합계를 1년치로 덮은 사고도 있었다. */}
        {!읽기전용 && (
          <span className="text-[11.5px] text-muted-foreground">
            저장하면 비목 인건비가 자동으로 맞춰집니다
          </span>
        )}
        <span className="ml-auto" />
        {msg && (
          <span className={msg.ok ? "text-[12.5px] text-muted-foreground" : "text-[12.5px] text-destructive"}>
            {msg.text}
          </span>
        )}
        {읽기전용 ? (
          <span className="text-[12.5px] text-muted-foreground">
            계상 확정 — 볼 수만 있습니다 (엑셀은 그대로 받을 수 있습니다)
          </span>
        ) : (
          <Button
            type="button"
            className="h-7 text-[12.8px]"
            disabled={pending || !더러움}
            onClick={저장}
          >
            {pending ? "저장 중…" : "인건비 저장"}
          </Button>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        총액 = 월급여 × 참여율 × 참여개월수 · 급여총액 = 월급여 × 12 · 재원은 현금(실제 급여이체) ·
        현물(기관부담) 둘 중 고릅니다. <b>저장하면 아래 연구비 계상의 인건비 줄이 재원별로 자동으로
        맞춰집니다</b>(연차를 가리지 않고 전 연차 합계입니다). 그래서 아래 표의 인건비 칸은 직접 못
        고칩니다 — 여기서 고칩니다. 엑셀은 실제 계상표 양식(한 사람 두 줄 · 자격·재원구분·총액
        세로 병합)으로 나갑니다.
      </p>
    </div>
  )
}
