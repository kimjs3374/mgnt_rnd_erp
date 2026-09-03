"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { deleteApplication } from "@/app/actions/apply"
// 기간 프리셋·겹침·연도는 과제 대장과 **같은 것을 쓴다**(복사하면 이름이 갈린다).
import { 기간프리셋, 범위정하기, 기간겹치나, 걸친연도, 기간_전체 } from "@/lib/date-filter"
import type { LedgerRow } from "@/lib/queries"

// lib/queries.ts 는 service_role 로 여는 lib/db 를 갖고 있어 클라이언트 번들에 넣지 않는다
// (CLAUDE.md §3.5 — service_role 은 서버 안에서만). won() 을 여기서 다시 만드는 이유.
const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")

const 전체_상태 = "전체"
const 모두 = "전체"
const 전체연도 = "전체"
const 보기단위 = [10, 20] as const
const 쪽없음 = 0
type SortKey = "사업명" | "기관" | "마감일"

/** funding_schemes.이름 을 그대로 옮긴다 — 화면에서 코드가 보이면 안 된다. */
const 사업유형_라벨: Record<string, string> = {
  NATIONAL_RND: "국가 R&D",
  LOCAL_TP: "지자체·TP 지원사업",
}

/**
 * 그 사업의 기간 — **협약기간이 먼저고, 없으면 공고일~마감일**이다.
 * 선정 전 건은 협약이 없다. 그때 「언제 공고된 건인가」가 사람이 찾는 기준이라 그걸 쓴다.
 */
function 사업기간(r: LedgerRow): { 시작: string | null; 끝: string | null } {
  const 협약시작 = (r as { 협약시작?: string | null }).협약시작 ?? null
  const 협약종료 = (r as { 협약종료?: string | null }).협약종료 ?? null
  if (협약시작 || 협약종료) return { 시작: 협약시작, 끝: 협약종료 }
  return { 시작: r.공고일 ?? null, 끝: r.마감일 ?? null }
}

/**
 * 단계별 줄 색 — 과제사업(`components/projects-ledger.tsx`)과 같은 색을 그대로 쓴다
 * (2026-09-04 사용자 지시: "지원사업 관리에서도 신청중 수행중 사업종료에 따라서 과제와
 * 같은 색으로 채워줘"). 두 화면이 정의를 따로 들고 있으면 한쪽만 고쳤을 때 색이 갈린다 —
 * 값(신청중·수행중·종료)도 색도 `app.projects` 한 테이블·같은 어휘를 그대로 읽는 것이라
 * 다를 이유가 없다.
 *   신청중 = 호박색, 수행중 = 하늘색, 종료 = 연빨강 (projects-ledger.tsx 48~61행과 동일)
 */
const 상태색: Record<string, string> = {
  신청중: "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60",
  수행중: "bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/60",
  종료: "bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900",
}
/** 범례 — 지금 표에 실제로 있는 색만 적는다(단계 화면에서는 한 색만 뜬다). */
const 상태색_범례: { 상태: string; 스와치: string; 이름: string; 설명: string }[] = [
  { 상태: "신청중", 스와치: "bg-amber-50 dark:bg-amber-950/60", 이름: "신청중", 설명: "결과를 기다리는 중입니다." },
  { 상태: "수행중", 스와치: "bg-sky-50 dark:bg-sky-950/60", 이름: "수행중", 설명: "협약기간 안에서 집행·증빙을 챙깁니다." },
  { 상태: "종료", 스와치: "bg-red-100 dark:bg-red-950", 이름: "종료", 설명: "끝난 사업입니다 — 문제가 있다는 뜻이 아닙니다." },
]

/** 마감이 가까울수록 눈에 띄게 — 표 안에서 「지금 급한 게 뭔지」가 스캔되게 한다. */
function DdayPill({ d }: { d: number }) {
  const tone =
    d < 0
      ? "border border-border text-muted-foreground"
      : d <= 3
        ? "bg-destructive/10 text-destructive"
        : d <= 14
          ? "bg-[var(--warning)] text-[var(--warning-fg)]"
          : "bg-secondary text-secondary-foreground"
  const label = d < 0 ? "마감" : d === 0 ? "오늘마감" : `D-${d}`
  return (
    <span
      className={
        "inline-flex h-5 w-fit shrink-0 items-center rounded-4xl px-2 text-xs font-medium tabular-nums " +
        tone
      }
    >
      {label}
    </span>
  )
}

export function ProgramsTable({ rows }: { rows: LedgerRow[] }) {
  const router = useRouter()
  const [search, setSearch] = React.useState("")
  const [상태, set상태] = React.useState(전체_상태)
  const [연도, set연도] = React.useState(전체연도)
  const [유형, set유형] = React.useState(모두)
  const [프리셋, set프리셋] = React.useState<string>(기간_전체)
  const [기간시작, set기간시작] = React.useState("")
  const [기간끝, set기간끝] = React.useState("")
  const [크기, set크기] = React.useState<number>(20)
  const [쪽, set쪽] = React.useState(쪽없음)
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null)
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
  // 삭제 확인 — 지우기는 되돌릴 수 없어서 한 번 더 물어본다. 대상만 여기 담아 둔다.
  const [삭제대상, set삭제대상] = React.useState<{ id: number; 사업명: string } | null>(null)
  const [삭제오류, set삭제오류] = React.useState<string | null>(null)
  const [삭제중, start삭제] = React.useTransition()

  /** 대장에 실제로 있는 연도만 낸다 — 없는 해를 고르게 하면 빈 표가 나온다. */
  const 연도목록 = React.useMemo(() => {
    const s = new Set<number>()
    for (const r of rows) {
      const { 시작, 끝 } = 사업기간(r)
      for (const y of 걸친연도(시작, 끝)) s.add(y)
    }
    return [...s].sort((a, b) => b - a)
  }, [rows])

  const 유형목록 = React.useMemo(
    () => [...new Set(rows.map((r) => r.사업유형).filter((v): v is string => !!v))].sort(),
    [rows],
  )

  const 범위 = React.useMemo(() => 범위정하기(프리셋, 기간시작, 기간끝), [프리셋, 기간시작, 기간끝])

  const 상태목록 = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.상태))).sort(),
    [rows],
  )

  const 필터된 = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const y = 연도 === 전체연도 ? null : Number(연도)
    let out = rows.filter((r) => {
      if (상태 !== 전체_상태 && r.상태 !== 상태) return false
      if (유형 !== 모두 && (r.사업유형 ?? "") !== 유형) return false
      const { 시작, 끝 } = 사업기간(r)
      // 연도는 「그 해에 걸쳐 있었는가」다 — 시작 연도만 보면 2024~2026 사업이 「2025」에서 빠진다.
      if (y != null && !걸친연도(시작, 끝).includes(y)) return false
      if (!기간겹치나(시작, 끝, 범위)) return false
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
  }, [rows, search, 상태, 연도, 유형, 범위, sortKey, sortDir])

  // 필터를 바꾸면 첫 쪽으로 — 3쪽을 보다가 걸러서 1쪽만 남으면 빈 화면이 뜬다.
  React.useEffect(() => {
    set쪽(쪽없음)
  }, [search, 상태, 연도, 유형, 프리셋, 기간시작, 기간끝, 크기])

  const 쪽수 = Math.max(1, Math.ceil(필터된.length / 크기))
  const 보이는 = 필터된.slice(쪽 * 크기, 쪽 * 크기 + 크기)

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
    set연도(전체연도)
    set유형(모두)
    set프리셋(기간_전체)
    set기간시작("")
    set기간끝("")
    setSortKey(null)
    setSortDir("asc")
  }

  const 필터걸림 =
    search.trim() !== "" ||
    상태 !== 전체_상태 ||
    연도 !== 전체연도 ||
    유형 !== 모두 ||
    프리셋 !== 기간_전체 ||
    기간시작 !== "" ||
    기간끝 !== ""

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

        {유형목록.length > 1 && (
          <Select value={유형} onValueChange={(v) => set유형(v ?? 모두)}>
            <SelectTrigger size="sm" className="h-7 w-36 text-[12.8px]" aria-label="사업유형으로 걸러내기">
              <SelectValue placeholder="유형 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={모두}>유형 전체</SelectItem>
              {유형목록.map((t) => (
                <SelectItem key={t} value={t}>
                  {사업유형_라벨[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* 기간 — 프리셋으로 대부분 끝나고, 안 맞으면 날짜를 직접 넣는다(과제 대장과 같은 모양).
            기준은 **협약기간**이고 없으면 공고일~마감일이다(선정 전 건은 협약이 없다). */}
        <Select
          value={프리셋}
          onValueChange={(v) => {
            set프리셋(v ?? 기간_전체)
            set기간시작("")
            set기간끝("")
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-32 text-[12.8px]" aria-label="기간 프리셋">
            <SelectValue placeholder="기간 전체" />
          </SelectTrigger>
          <SelectContent>
            {기간프리셋.map((p) => (
              <SelectItem key={p.v} value={p.v}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={기간시작}
          onChange={(e) => set기간시작(e.target.value)}
          className="h-7 w-[132px] text-[12.8px]"
          aria-label="기간 시작"
        />
        <span className="text-xs text-muted-foreground">~</span>
        <Input
          type="date"
          value={기간끝}
          onChange={(e) => set기간끝(e.target.value)}
          className="h-7 w-[132px] text-[12.8px]"
          aria-label="기간 끝"
        />

        <Select value={String(크기)} onValueChange={(v) => set크기(Number(v) || 20)}>
          <SelectTrigger size="sm" className="h-7 w-20 text-[12.8px]" aria-label="한 쪽에 몇 줄">
            <SelectValue placeholder="20" />
          </SelectTrigger>
          <SelectContent>
            {보기단위.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">{필터된.length}건</span>

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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {보이는.map((r) => (
                <TableRow
                  key={r.id}
                  className={"h-[38px] text-[13px] cursor-pointer " + (상태색[r.상태] ?? "")}
                  onClick={() => router.push(`/projects/${r.id}`)}
                >
                  <TableCell className="font-semibold">{r.사업명}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.기관 ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.사업유형 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.마감일 ? (
                      <div className="flex flex-col gap-0.5">
                        {r.d_day != null && <DdayPill d={r.d_day} />}
                        <span className="text-[11px] text-muted-foreground">{r.마감일}</span>
                      </div>
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
                  <TableCell className="p-0 text-center">
                    <button
                      type="button"
                      title="이 건 삭제"
                      aria-label="이 건 삭제"
                      onClick={(e) => {
                        e.stopPropagation()
                        set삭제오류(null)
                        set삭제대상({ id: r.id, 사업명: r.사업명 })
                      }}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* 색이 무엇을 뜻하는지 적어 둔다 — 안 적으면 빨강을 「문제 있는 사업」으로 읽는다.
          지금 필터된 표에 실제로 있는 색만 보여준다(projects-ledger.tsx와 같은 규칙). */}
      {상태색_범례.some((s) => 필터된.some((r) => r.상태 === s.상태)) && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
          {상태색_범례
            .filter((s) => 필터된.some((r) => r.상태 === s.상태))
            .map((s) => (
              <span key={s.상태} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-5 rounded-sm border ${s.스와치}`} />
                <span className="text-foreground">{s.이름}</span>
                {s.설명}
              </span>
            ))}
        </p>
      )}

      <Dialog
        open={삭제대상 != null}
        onOpenChange={(o) => {
          if (!o) {
            set삭제대상(null)
            set삭제오류(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이 지원 건을 삭제할까요?</DialogTitle>
            <DialogDescription>
              「{삭제대상?.사업명}」이 지원사업 대장에서 완전히 사라집니다. 이미 예산·집행·서류가
              쌓인 건은 삭제할 수 없습니다 — 그런 경우 상세 화면에서 「미선정」으로 남기세요.
            </DialogDescription>
          </DialogHeader>
          {삭제오류 && <p className="text-sm text-destructive">{삭제오류}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => set삭제대상(null)}>
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={삭제중}
              onClick={() => {
                if (!삭제대상) return
                const id = 삭제대상.id
                start삭제(async () => {
                  const r = await deleteApplication(id)
                  if (r.ok) {
                    set삭제대상(null)
                    router.refresh()
                  } else {
                    set삭제오류(r.error ?? "삭제하지 못했습니다.")
                  }
                })
              }}
            >
              {삭제중 ? "삭제 중…" : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
