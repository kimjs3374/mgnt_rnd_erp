"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/page-shell"
import type { 업로드기록 } from "@/lib/queries-upload-log"

/**
 * 서류 올린 기록 — **누가(아이디) 언제 무엇을 올렸나.**
 *
 * 보는 화면이다. 여기서 파일을 내려받거나 지우지 않는다 —
 * 그 일은 각 서류함에서 한다. 로그가 조작 창을 겸하면 「기록」이 아니게 된다.
 */

/** ISO → `2026-09-04 09:25` (KST). 서버·클라이언트가 같은 값을 내야 해서 직접 계산한다. */
function 시각(iso: string | null) {
  if (!iso) return "—"
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

const KB = (n: number | null) =>
  n == null
    ? ""
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))}KB`
      : `${(n / 1024 / 1024).toFixed(1)}MB`

const 개수후보 = [20, 50, 100]

export function UploadLogTable({ 기록 }: { 기록: 업로드기록[] }) {
  const [검색, set검색] = React.useState("")
  const [구분, set구분] = React.useState("전체")
  const [사람, set사람] = React.useState("전체")
  const [개수, set개수] = React.useState(20)
  const [쪽, set쪽] = React.useState(1)

  const 구분목록 = React.useMemo(
    () => ["전체", ...[...new Set(기록.map((r) => r.구분))]],
    [기록],
  )
  // 아이디로 고른다(사용자 지시). 확인 안 된 기록은 따로 묶어 고를 수 있게 둔다 —
  // 「누가 올렸는지 모르는 것만 보기」가 실제로 필요한 조회다.
  const 사람목록 = React.useMemo(
    () => [
      "전체",
      ...[...new Set(기록.map((r) => r.아이디).filter((x): x is string => !!x))].sort(),
      "확인 안 됨",
    ],
    [기록],
  )

  const 걸러진 = React.useMemo(() => {
    const q = 검색.trim().toLowerCase()
    return 기록.filter((r) => {
      if (구분 !== "전체" && r.구분 !== 구분) return false
      if (사람 === "확인 안 됨" ? !!r.아이디 : 사람 !== "전체" && r.아이디 !== 사람) return false
      if (!q) return true
      return [r.파일명, r.서류명, r.어디, r.아이디 ?? "", r.표시명]
        .join(" ")
        .toLowerCase()
        .includes(q)
    })
  }, [기록, 검색, 구분, 사람])

  const 쪽수 = Math.max(1, Math.ceil(걸러진.length / 개수))
  const 현재쪽 = Math.min(쪽, 쪽수)
  const 보이는 = 걸러진.slice((현재쪽 - 1) * 개수, 현재쪽 * 개수)
  React.useEffect(() => set쪽(1), [검색, 구분, 사람, 개수])

  const 초기화 = () => {
    set검색("")
    set구분("전체")
    set사람("전체")
    set개수(20)
  }
  const 걸림 = 검색 !== "" || 구분 !== "전체" || 사람 !== "전체"

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={검색}
          onChange={(e) => set검색(e.target.value)}
          placeholder="파일명 · 서류명 · 과제 · 아이디"
          className="h-7 w-[240px] text-[12.8px]"
          aria-label="기록 검색"
        />
        <select
          value={구분}
          onChange={(e) => set구분(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-[12.8px]"
          aria-label="구분"
        >
          {구분목록.map((v) => (
            <option key={v} value={v}>
              {v === "전체" ? "구분 전체" : v}
            </option>
          ))}
        </select>
        <select
          value={사람}
          onChange={(e) => set사람(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-[12.8px]"
          aria-label="올린 사람"
        >
          {사람목록.map((v) => (
            <option key={v} value={v}>
              {v === "전체" ? "올린 사람 전체" : v}
            </option>
          ))}
        </select>
        <select
          value={개수}
          onChange={(e) => set개수(Number(e.target.value))}
          className="h-7 rounded-md border bg-background px-2 text-[12.8px]"
          aria-label="한 쪽 줄 수"
        >
          {개수후보.map((v) => (
            <option key={v} value={v}>
              {v}개씩
            </option>
          ))}
        </select>
        {걸림 && (
          <Button type="button" variant="ghost" className="h-7 text-[12px]" onClick={초기화}>
            초기화
          </Button>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {걸러진.length}건{걸림 ? ` / 전체 ${기록.length}건` : ""}
        </span>
      </div>

      <div className="rounded-lg border bg-card">
        {보이는.length === 0 ? (
          <EmptyState
            title="기록이 없습니다"
            hint={
              기록.length === 0
                ? "서류를 올리면 누가 언제 올렸는지 여기 쌓입니다."
                : "조건에 맞는 기록이 없습니다. 초기화해 보세요."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[132px]">올린 때</TableHead>
                <TableHead className="w-[104px]">올린 사람</TableHead>
                <TableHead className="w-[92px]">구분</TableHead>
                <TableHead className="w-[200px]">어디에</TableHead>
                <TableHead className="w-[132px]">서류</TableHead>
                <TableHead>파일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {보이는.map((r) => (
                <TableRow key={r.키} className="h-[38px] text-[13px]">
                  <TableCell className="tabular-nums text-muted-foreground">
                    {시각(r.일시)}
                  </TableCell>
                  <TableCell>
                    {r.아이디 ? (
                      <span className="font-medium">{r.아이디}</span>
                    ) : (
                      /* 로그인 붙기 전(09-03)·테스트가 넣은 것. 아무 이름이나 적으면 기록이
                         거짓말을 한다 — 「확인 안 됨」이 정직하다. 남은 표시명은 참고로만. */
                      <span
                        className="text-[12px] text-[var(--warning-fg)]"
                        title={r.표시명 ? `기록에 남은 이름: ${r.표시명} (로그인 확인 안 됨)` : undefined}
                      >
                        확인 안 됨
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{r.구분}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-[12.5px]" title={r.어디}>
                    {r.어디 || "—"}
                  </TableCell>
                  <TableCell className="text-[12.5px]">{r.서류명}</TableCell>
                  <TableCell className="whitespace-normal">
                    {r.파일명}
                    {r.크기 != null && (
                      <span className="ml-1.5 text-[11.5px] tabular-nums text-muted-foreground">
                        {KB(r.크기)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {쪽수 > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={현재쪽 <= 1}
            onClick={() => set쪽(현재쪽 - 1)}
          >
            이전
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {현재쪽} / {쪽수}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={현재쪽 >= 쪽수}
            onClick={() => set쪽(현재쪽 + 1)}
          >
            다음
          </Button>
        </div>
      )}
    </>
  )
}
