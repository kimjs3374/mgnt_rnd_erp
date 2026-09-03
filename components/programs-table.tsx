"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
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
import type { LedgerRow } from "@/lib/queries"

// lib/queries.ts 는 service_role 로 여는 lib/db 를 갖고 있어 클라이언트 번들에 넣지 않는다
// (CLAUDE.md §3.5 — service_role 은 서버 안에서만). won() 을 여기서 다시 만드는 이유.
const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")

const 전체_상태 = "전체"
type SortKey = "사업명" | "기관" | "마감일"

export function ProgramsTable({ rows }: { rows: LedgerRow[] }) {
  const router = useRouter()
  const [search, setSearch] = React.useState("")
  const [상태, set상태] = React.useState(전체_상태)
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null)
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")

  const 상태목록 = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.상태))).sort(),
    [rows],
  )

  const 필터된 = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows.filter((r) => {
      if (상태 !== 전체_상태 && r.상태 !== 상태) return false
      if (!q) return true
      return (
        r.사업명.toLowerCase().includes(q) ||
        (r.기관 ?? "").toLowerCase().includes(q)
      )
    })
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        // 값 없는 쪽은 항상 뒤로 — 정렬 방향과 관계없이 "확인 필요"가 위로 튀지 않게.
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        const cmp = String(av).localeCompare(String(bv), "ko")
        return sortDir === "asc" ? cmp : -cmp
      })
    }
    return out
  }, [rows, search, 상태, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
    } else if (sortDir === "asc") {
      setSortDir("desc")
    } else {
      setSortKey(null)
    }
  }

  function 초기화() {
    setSearch("")
    set상태(전체_상태)
    setSortKey(null)
    setSortDir("asc")
  }

  const 필터걸림 = search.trim() !== "" || 상태 !== 전체_상태

  function Header({ label, sortk }: { label: string; sortk: SortKey }) {
    const active = sortKey === sortk
    return (
      <TableHead>
        <button
          type="button"
          onClick={() => toggleSort(sortk)}
          className="inline-flex items-center gap-0.5 hover:text-foreground"
        >
          {label}
          <span className={active ? "text-foreground" : "text-muted-foreground/50"}>
            {active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
          </span>
        </button>
      </TableHead>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="사업명·기관 검색"
          className="h-7 w-56 text-[13px]"
        />
        <span className="text-xs text-muted-foreground">상태</span>
        <Select value={상태} onValueChange={(v) => set상태(v ?? 전체_상태)}>
          <SelectTrigger size="sm" className="h-7 w-28 text-[12.8px]">
            <SelectValue placeholder={전체_상태} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={전체_상태}>전체</SelectItem>
            {상태목록.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            title="등록된 지원사업이 없습니다"
            hint="공고에서 신청을 시작하거나 관리대장을 가져오면 여기에 쌓입니다."
          />
        ) : 필터된.length === 0 ? (
          <EmptyState
            title="조건에 맞는 사업이 없습니다"
            hint="검색어나 상태 필터를 바꿔 보세요."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <Header label="사업명" sortk="사업명" />
                <Header label="기관" sortk="기관" />
                <TableHead>유형</TableHead>
                <Header label="마감일" sortk="마감일" />
                <TableHead className="text-right">지원금액</TableHead>
                <TableHead className="text-right">사용금액</TableHead>
                <TableHead>결과</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">점검</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {필터된.map((r) => (
                <TableRow
                  key={r.id}
                  className="h-[38px] text-[13px] cursor-pointer"
                  onClick={() => router.push(`/projects/${r.id}`)}
                >
                  <TableCell className="font-medium">{r.사업명}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.기관 ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.사업유형 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.마감일 ? (
                      <span>
                        {r.마감일}
                        {r.d_day != null && r.d_day >= 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            D-{r.d_day}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">확인 필요</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(r.지원금액)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(r.사용금액)}
                  </TableCell>
                  <TableCell>
                    {r.선정결과 ? <StatusBadge value={r.선정결과} /> : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={r.상태} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.미처리점검 > 0 ? (
                      <span className="text-[var(--warning-fg)]">{r.미처리점검}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}
