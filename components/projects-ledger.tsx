"use client"

import * as React from "react"
import Link from "next/link"
import { Card, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ProjectRow } from "@/lib/queries"
import { 연차수, 현재연차, 기간표기, 연차연도 } from "@/lib/fiscal-year"

// lib/queries.ts 는 service_role 로 여는 lib/db 를 갖고 있어 클라이언트 번들에 넣지 않는다
// (CLAUDE.md §3.5). 타입만 가져오고 won() 은 여기서 다시 만든다 — programs-table.tsx 와 같은 이유.
const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")

// funding_schemes.이름 을 그대로 옮긴다 — 화면에서 지어내지 않는다.
const 사업유형_라벨: Record<string, string> = {
  NATIONAL_RND: "국가 R&D",
  LOCAL_TP: "지자체·TP 지원사업",
}

const 전체연도 = "전체"
const 보기단위 = [10, 20] as const
const 전체보기 = 0

/**
 * 과제사업 대장의 표 — 걸러내기 · 연도 · 쪽 나누기.
 *
 * 12건뿐이라 **서버로 다시 묻지 않고 화면에서 거른다.** 집행 표(`expense-table.tsx`)와
 * 지원사업 표(`programs-table.tsx`)가 이미 그렇게 돌고 있어서 방식을 맞췄다 —
 * 화면마다 거르는 방식이 다르면 사람이 매번 다시 배운다.
 *
 * **연도 필터는 「그 해에 수행 중이었는가」다.** 시작일·종료일이 걸친 회계연도를 모두 친다
 * (`lib/fiscal-year.ts`). 2022-06~2024-05 과제는 2022 · 2023 · 2024 셋 다에서 잡힌다 —
 * 시작연도만 보면 「2023년에 뭘 하고 있었나」에 답할 수 없다.
 */
export function ProjectsLedger({ rows }: { rows: ProjectRow[] }) {
  const [search, setSearch] = React.useState("")
  const [연도, set연도] = React.useState<string>(전체연도)
  const [종료숨김, set종료숨김] = React.useState(false)
  const [크기, set크기] = React.useState<number>(20)
  const [쪽, set쪽] = React.useState(1)

  // 실제로 과제가 걸쳐 있는 해만 고를 수 있게 한다. 빈 해를 골라 0건을 보여주지 않는다.
  const 연도목록 = React.useMemo(() => {
    const s = new Set<number>()
    for (const r of rows) for (const y of 연차연도(r.시작일, r.종료일)) s.add(y)
    return [...s].sort((a, b) => b - a)
  }, [rows])

  const 필터된 = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const y = 연도 === 전체연도 ? null : Number(연도)
    return rows.filter((r) => {
      if (종료숨김 && r.상태 === "종료") return false
      if (y != null && !연차연도(r.시작일, r.종료일).includes(y)) return false
      if (!q) return true
      return [r.과제명, r.과제코드, r.부처, r.전문기관, r.사업명]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    })
  }, [rows, search, 연도, 종료숨김])

  // 조건이 바뀌면 1쪽으로 돌아간다. 3쪽을 보다 걸러서 1쪽밖에 없으면 빈 화면이 뜬다.
  React.useEffect(() => {
    set쪽(1)
  }, [search, 연도, 종료숨김, 크기])

  const 쪽수 = 크기 === 전체보기 ? 1 : Math.max(1, Math.ceil(필터된.length / 크기))
  const 지금쪽 = Math.min(쪽, 쪽수)
  const 보이는 =
    크기 === 전체보기 ? 필터된 : 필터된.slice((지금쪽 - 1) * 크기, 지금쪽 * 크기)
  const 처음 = 필터된.length === 0 ? 0 : (지금쪽 - 1) * (크기 === 전체보기 ? 0 : 크기) + 1
  const 끝 = 크기 === 전체보기 ? 필터된.length : Math.min(지금쪽 * 크기, 필터된.length)

  const 필터걸림 = search.trim() !== "" || 연도 !== 전체연도 || 종료숨김
  function 초기화() {
    setSearch("")
    set연도(전체연도)
    set종료숨김(false)
    set쪽(1)
  }

  const 종료수 = rows.filter((r) => r.상태 === "종료").length

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="과제명·과제코드·부처 검색"
          className="h-7 w-56 text-[13px]"
        />

        <span className="text-xs text-muted-foreground">수행 연도</span>
        <Select value={연도} onValueChange={(v) => set연도(v ?? 전체연도)}>
          <SelectTrigger size="sm" className="h-7 w-24 text-[12.8px]" aria-label="수행 연도로 걸러내기">
            <SelectValue placeholder={전체연도} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={전체연도}>전체</SelectItem>
            {연도목록.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}년
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 종료 숨김 — 누른 상태가 눈에 보여야 한다. 안 보이면 「과제가 사라졌다」가 된다. */}
        <Button
          type="button"
          variant={종료숨김 ? "default" : "outline"}
          className="h-7 text-[12.8px]"
          aria-pressed={종료숨김}
          onClick={() => set종료숨김((v) => !v)}
          title={`종료된 과제 ${종료수}건`}
        >
          {종료숨김 ? `종료 숨김 (${종료수}건)` : "종료 숨기기"}
        </Button>

        <Select value={String(크기)} onValueChange={(v) => set크기(Number(v))}>
          <SelectTrigger size="sm" className="h-7 w-24 text-[12.8px]" aria-label="한 쪽에 볼 개수">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {보기단위.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}개씩
              </SelectItem>
            ))}
            <SelectItem value={String(전체보기)}>전체</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground tabular-nums">
          {필터된.length}건
          {필터걸림 && ` (전체 ${rows.length}건)`}
        </span>

        {필터걸림 && (
          <Button
            type="button"
            variant="ghost"
            onClick={초기화}
            className="ml-auto h-7 text-[12.8px]"
          >
            ↺ 초기화
          </Button>
        )}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="선정된 과제가 없습니다"
            hint="공고에서 지원을 등록하고 선정되면 여기에 쌓입니다."
          />
        ) : 필터된.length === 0 ? (
          <EmptyState
            title="조건에 맞는 과제가 없습니다"
            hint={
              종료숨김 && rows.every((r) => r.상태 === "종료")
                ? "지금 있는 과제가 전부 종료된 건입니다. 「종료 숨김」을 풀어 보세요."
                : "검색어나 연도를 바꿔 보세요."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[280px]">과제명</TableHead>
                <TableHead>과제코드</TableHead>
                <TableHead>부처 / 전문기관</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>수행기간</TableHead>
                <TableHead className="text-right">연차 (현재/총)</TableHead>
                <TableHead className="text-right">총사업비</TableHead>
                <TableHead className="text-right">정부지원금</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {보이는.map((r) => {
                // 끝난 과제는 줄 전체를 연빨강으로 칠한다(사용자 지시). 배지 하나로는
                // 열 줄 중 어느 게 끝난 건지 훑어서 안 잡힌다.
                // ⚠ `TableRow` 기본 클래스에 `hover:bg-muted/50` 이 있다. `cn()`(tailwind-merge)을
                //    거치므로 `hover:bg-red-200` 을 같이 줘야 마우스를 올렸을 때 빨강이 안 사라진다.
                const 끝남 = r.상태 === "종료"
                return (
                  <TableRow
                    key={r.id}
                    className={
                      "h-[38px] text-[13px] " +
                      (끝남 ? "bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900" : "")
                    }
                  >
                    <TableCell className="font-medium">
                      {/* 계상·정산은 과제 안에서 한다. 목록은 어느 과제로 들어갈지만 고른다. */}
                      <Link
                        href={`/projects/${r.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.과제명}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.과제코드 ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.부처 ?? "—"}
                      {r.전문기관 ? ` · ${r.전문기관}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.사업유형 ? (사업유형_라벨[r.사업유형] ?? r.사업유형) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.시작일 ?? "확인 필요"} ~ {r.종료일 ?? "확인 필요"}
                    </TableCell>
                    {/* 연차는 회계연도로 센다 — 2022-06~2024-05 는 기간 2년이어도 3개 연차다.
                        저장된 `projects.연차` 를 그대로 찍지 않고 기간에서 계산한다. */}
                    <TableCell
                      className="text-right tabular-nums"
                      title={기간표기(r.시작일, r.종료일)}
                    >
                      {연차수(r.시작일, r.종료일)
                        ? `${현재연차(r.시작일, r.종료일)} / ${연차수(r.시작일, r.종료일)}`
                        : (r.연차 ?? "—")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{won(r.총사업비)}</TableCell>
                    <TableCell className="text-right tabular-nums">{won(r.정부지원금)}</TableCell>
                    <TableCell>
                      <StatusBadge value={r.상태} />
                    </TableCell>
                    <TableCell className="text-right">
                      {/* 종료된 과제에는 「계상」을 걸지 않는다 — 계상은 협약·수행 중에 하는 일이다.
                          지난 계상은 정산 탭의 과제비 원장에서 그대로 본다. */}
                      {!끝남 && (
                        <>
                          <Link
                            href={`/projects/${r.id}/budget`}
                            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          >
                            계상
                          </Link>
                          <span className="px-1.5 text-xs text-muted-foreground">·</span>
                        </>
                      )}
                      <Link
                        href={`/projects/${r.id}/settlement`}
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        정산
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* 몇 번째를 보고 있는지는 **늘** 적는다. 지금은 10건뿐이라 「10개씩」을 골라도 한 쪽에
          다 들어가는데, 아무 표시가 없으면 사람이 고장으로 읽는다.
          이전·다음 버튼만 쪽이 둘 이상일 때 낸다 — 누를 데 없는 버튼을 두지 않는다. */}
      {필터된.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {처음}–{끝} / {필터된.length}건
            {쪽수 === 1 && 크기 !== 전체보기 && ` · 한 쪽에 다 들어갑니다`}
          </span>
          <div className={쪽수 > 1 ? "ml-auto flex items-center gap-1" : "hidden"}>
            <Button
              type="button"
              variant="outline"
              className="h-7 text-[12.8px]"
              disabled={지금쪽 <= 1}
              onClick={() => set쪽((v) => Math.max(1, v - 1))}
            >
              ‹ 이전
            </Button>
            <span className="px-1 text-xs text-muted-foreground tabular-nums">
              {지금쪽} / {쪽수}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-7 text-[12.8px]"
              disabled={지금쪽 >= 쪽수}
              onClick={() => set쪽((v) => Math.min(쪽수, v + 1))}
            >
              다음 ›
            </Button>
          </div>
        </div>
      )}

      {/* 색이 무엇을 뜻하는지 화면에 적어 둔다. 안 적으면 빨강을 「문제 있는 과제」로 읽는다. */}
      {보이는.some((r) => r.상태 === "종료") && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-5 rounded-sm border bg-red-100 dark:bg-red-950" />
          <span className="text-foreground">종료된 과제</span>입니다 — 나머지는 수행 중입니다.
          문제가 있다는 뜻이 아니라 끝났다는 뜻입니다.
        </p>
      )}
    </>
  )
}
