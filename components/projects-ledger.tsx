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
// 기간 프리셋·겹침 판정은 지원사업 대장과 **같은 것을 쓴다**(`lib/date-filter.ts`) —
// 복사해 두면 이름이 갈린다(「올해 걸친 것」 → 「올해」로 바꿀 때 실제로 그럴 뻔했다).
import { 기간프리셋, 프리셋범위 } from "@/lib/date-filter"
import { ProjectLeadCell } from "@/components/project-lead-cell"
import { 종료로표시 } from "@/app/actions/project-stage"
import { StageAdvance } from "@/components/stage-advance"
import type { 과제단계, 보기범위 } from "@/lib/project-stage"

// lib/queries.ts 는 service_role 로 여는 lib/db 를 갖고 있어 클라이언트 번들에 넣지 않는다
// (CLAUDE.md §3.5). 타입만 가져오고 won() 은 여기서 다시 만든다 — programs-table.tsx 와 같은 이유.
const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")

// funding_schemes.이름 을 그대로 옮긴다 — 화면에서 지어내지 않는다.
const 사업유형_라벨: Record<string, string> = {
  NATIONAL_RND: "국가 R&D",
  LOCAL_TP: "지자체·TP 지원사업",
}

/** 표 안에서 쓰는 짧은 이름. 열 하나가 「지자체·TP 지원사업」 때문에 넓어지는 걸 막는다. */
const 사업유형_짧게: Record<string, string> = {
  NATIONAL_RND: "국가 R&D",
  LOCAL_TP: "지자체·TP",
}

/**
 * 단계별 줄 색 — **연하게**(사용자 지시, 2026-09-04). 종료(연빨강)는 이미 있던 색이고
 * 여기에 신청중·수행중을 더한다. 「전체」 화면은 세 단계가 한 표에 섞여 있어서
 * 「단계」 텍스트 열만으로는 죽 훑을 때 안 잡힌다 — 색으로 먼저 갈라 보이게 한다.
 *   신청중 = 호박색(대기 느낌, 이 앱의 warning 톤과 같은 계열)
 *   수행중 = 하늘색(지금 진행 중이라는 느낌, 경고·위험 계열과 겹치지 않게)
 *   종료   = 연빨강(기존 그대로)
 * ⚠ `TableRow` 기본 클래스에 `hover:bg-muted/50` 이 있다. `cn()`(tailwind-merge)을 거치므로
 *   hover 색을 같이 안 주면 마우스를 올렸을 때 칠한 색이 사라진다(종료 줄에서 이미 겪은 함정).
 */
// 2026-09-04 재조정 — "꼭 이렇게 진해야 하나" 사용자 질문에, 구분은 남기되 더 연하게.
// 팔레트 최저단계(-50/-100)에 opacity 를 한 번 더 얹어(반투명) 카드 배경에 옅게 스민다.
// ⚠ 키는 **저장된 상태가 아니라 단계**다(`lib/project-stage.ts`). 배지를 단계로 바꾸면서
//    같이 맞췄다 — 안 맞추면 「배지는 신청완료인데 줄 색은 신청중」이 된다.
//    신청완료는 신청중과 같은 대기 계열이되 한 걸음 진한 호박색으로 둔다: 옆줄과 구분되어야
//    「어디까지 왔나」가 훑어서 잡힌다.
const 상태색: Record<string, string> = {
  신청중: "bg-amber-50/50 hover:bg-amber-100/60 dark:bg-amber-950/40 dark:hover:bg-amber-900/50",
  신청완료: "bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-800/50",
  수행중: "bg-sky-50/50 hover:bg-sky-100/60 dark:bg-sky-950/40 dark:hover:bg-sky-900/50",
  사업종료: "bg-red-100/40 hover:bg-red-200/50 dark:bg-red-950/60 dark:hover:bg-red-900/60",
}
/** 범례에 쓰는 스와치 색(hover 뺀 배경만) + 이름. 순서가 곧 범례 순서다. */
const 상태색_범례: { 상태: string; 스와치: string; 이름: string; 설명: string }[] = [
  { 상태: "신청중", 스와치: "bg-amber-50/50 dark:bg-amber-950/40", 이름: "신청중", 설명: "접수했고 발표·심사를 기다리는 중입니다." },
  { 상태: "신청완료", 스와치: "bg-amber-100/60 dark:bg-amber-900/40", 이름: "신청완료", 설명: "발표·심사까지 마치고 최종 결과만 남았습니다." },
  { 상태: "수행중", 스와치: "bg-sky-50/50 dark:bg-sky-950/40", 이름: "수행중", 설명: "협약기간 안에서 계상·집행·정산을 합니다." },
  { 상태: "사업종료", 스와치: "bg-red-100/40 dark:bg-red-950/60", 이름: "사업종료", 설명: "끝난 과제입니다 — 문제가 있다는 뜻이 아닙니다." },
]

/** 단계 필터가 고를 수 있는 값 전부. 기본은 넷 다 켜진 상태 = 「전체」와 같다. */
const 단계전체목록: 과제단계[] = ["신청중", "신청완료", "수행중", "사업종료"]

const 전체연도 = "전체"
const 모두 = "전체"
const 보기단위 = [10, 20] as const
const 쪽없음 = 0

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
export function ProjectsLedger({
  rows,
  책임자,
  로그인,
  단계,
  단계별 = {},
  증빙 = {},
  밀린종료 = [],
}: {
  rows: ProjectRow[]
  /** 이 화면이 보여주는 범위. 「전체」면 단계 열과 단계 필터가 같이 나온다. */
  단계?: 보기범위
  /**
   * 과제 id → 단계. 단계는 저장값이 아니라 계산값이라(`lib/project-stage.ts`)
   * 서버가 판정해서 넘긴다 — 화면이 다시 판정하면 두 곳에서 규칙이 갈린다.
   */
  단계별?: Record<number, 과제단계>
  /**
   * 과제 id → 사업비 증빙 구멍(집행 건별 필수 서류 기준, `lib/queries-evidence-gap.ts`).
   * 구멍이 없는 과제는 **키가 아예 없다** — 있는 것만 표시한다.
   */
  증빙?: Record<number, { 집행건: number; 빈집행건: number; 빈칸: number; 빈집행ids: number[] }>
  /**
   * 수행기간은 끝났는데 저장된 `상태` 가 아직 「수행중」인 과제 id.
   * 사업종료 화면에서만 넘어온다 — 화면이 짚어 주고 사람이 눌러 맞춘다.
   */
  밀린종료?: number[]
  /**
   * 과제 id → 연구책임자 표시명. `app.projects` 가 `supabase_admin` 소유라 컬럼을 못 붙여
   * 옆 테이블(`app.project_leads`)에 있다(`db/104_project_lead.sql`). 그래서 따로 받는다.
   */
  책임자: Record<number, string>
  로그인?: boolean
}) {
  const [search, setSearch] = React.useState("")
  const [연도, set연도] = React.useState<string>(전체연도)
  /**
   * 단계 필터 — **여러 개를 동시에 켤 수 있다**(2026-09-04 사용자 지시).
   * "신청중이랑 수행중만 보고 싶다"처럼 셋 중 두 개를 골라 보는 것이 실제 쓰임이라
   * 하나만 고르는 드롭다운으로는 안 된다. 기본은 셋 다 켜진 상태 — 그게 「전체」다.
   */
  const [단계선택, set단계선택] = React.useState<Set<과제단계>>(() => new Set(단계전체목록))
  const [유형, set유형] = React.useState<string>(모두)
  const [프리셋, set프리셋] = React.useState<string>("전체")
  const [기간시작, set기간시작] = React.useState("")
  const [기간끝, set기간끝] = React.useState("")
  const [크기, set크기] = React.useState<number>(20)
  const [쪽, set쪽] = React.useState(1)

  const 전체보기중 = 단계 === "전체"

  // 실제로 과제가 걸쳐 있는 해만 고를 수 있게 한다. 빈 해를 골라 0건을 보여주지 않는다.
  const 연도목록 = React.useMemo(() => {
    const s = new Set<number>()
    for (const r of rows) for (const y of 연차연도(r.시작일, r.종료일)) s.add(y)
    return [...s].sort((a, b) => b - a)
  }, [rows])

  /** 화면에 실제로 있는 사업유형만 고를 수 있게 한다. 빈 유형을 골라 0건을 보여주지 않는다. */
  const 유형목록 = React.useMemo(
    () => [...new Set(rows.map((r) => r.사업유형).filter(Boolean) as string[])].sort(),
    [rows],
  )

  // 기간은 프리셋과 직접 입력 중 **나중에 손댄 쪽**이 이긴다(집행 표와 같은 규칙).
  const 범위 = React.useMemo(() => {
    if (기간시작 || 기간끝) return { 시작: 기간시작, 끝: 기간끝 }
    const p = 프리셋범위(프리셋)
    return p ? p : null
  }, [프리셋, 기간시작, 기간끝])

  const 필터된 = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const y = 연도 === 전체연도 ? null : Number(연도)
    return rows.filter((r) => {
      if (전체보기중 && !단계선택.has(단계별[r.id])) return false
      if (유형 !== 모두 && (r.사업유형 ?? "") !== 유형) return false
      if (y != null && !연차연도(r.시작일, r.종료일).includes(y)) return false
      if (범위) {
        // **겹치면 걸린다.** 시작일이 범위 안인 것만 고르면 2022~2024 과제가 「올해」에서 빠진다 —
        // 올해도 수행 중인데 안 나오면 「올해 뭘 하고 있나」에 틀린 답을 준다.
        const s = String(r.시작일 ?? "").slice(0, 10)
        const e = String(r.종료일 ?? "").slice(0, 10)
        if (범위.끝 && s && s > 범위.끝) return false
        if (범위.시작 && e && e < 범위.시작) return false
        // 날짜가 아예 없는 건은 기간을 걸면 빠진다. 그게 맞다 — 기간 확인 대상이 아니다.
        if ((범위.시작 || 범위.끝) && (!s || !e)) return false
      }
      if (!q) return true
      // 연구책임자도 검색에 넣는다 — 「홍길동이 맡은 과제」를 찾는 게 이 열을 붙인 이유다.
      return [r.과제명, r.과제코드, r.부처, r.전문기관, r.사업명, 책임자[r.id]]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    })
  }, [rows, search, 연도, 책임자, 전체보기중, 단계선택, 단계별, 유형, 범위])

  // 조건이 바뀌면 1쪽으로 돌아간다. 3쪽을 보다 걸러서 1쪽밖에 없으면 빈 화면이 뜬다.
  React.useEffect(() => {
    set쪽(1)
  }, [search, 연도, 크기, 단계선택, 유형, 프리셋, 기간시작, 기간끝])

  const 쪽수 = 크기 === 쪽없음 ? 1 : Math.max(1, Math.ceil(필터된.length / 크기))
  const 지금쪽 = Math.min(쪽, 쪽수)
  const 보이는 =
    크기 === 쪽없음 ? 필터된 : 필터된.slice((지금쪽 - 1) * 크기, 지금쪽 * 크기)
  const 처음 = 필터된.length === 0 ? 0 : (지금쪽 - 1) * (크기 === 쪽없음 ? 0 : 크기) + 1
  const 끝 = 크기 === 쪽없음 ? 필터된.length : Math.min(지금쪽 * 크기, 필터된.length)

  const 필터걸림 =
    search.trim() !== "" ||
    연도 !== 전체연도 ||
    단계선택.size !== 단계전체목록.length ||
    유형 !== 모두 ||
    프리셋 !== "전체" ||
    !!기간시작 ||
    !!기간끝
  function 초기화() {
    setSearch("")
    set연도(전체연도)
    set단계선택(new Set(단계전체목록))
    set유형(모두)
    set프리셋("전체")
    set기간시작("")
    set기간끝("")
    set쪽(1)
  }

  /** 단계 칩 하나를 켜고 끈다. 마지막 하나까지 끌 수 있다 — 그럼 0건이 뜬다(정직한 결과다). */
  function 단계토글(s: 과제단계) {
    set단계선택((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  // 수행기간이 끝났는데 저장된 상태가 아직 「수행중」인 건 맞추기.
  const [맞춤중, 맞춤시작] = React.useTransition()
  const [맞춤말, set맞춤말] = React.useState<string | null>(null)
  function 종료로맞추기() {
    set맞춤말(null)
    맞춤시작(async () => {
      const r = await 종료로표시(밀린종료)
      set맞춤말(r.ok ? `${r.바뀐수}건을 종료로 기록했습니다.` : (r.error ?? "바꾸지 못했습니다."))
    })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="과제명·과제코드·부처 검색"
          className="h-7 w-56 text-[14.3px]"
        />

        <span className="text-xs text-muted-foreground">수행 연도</span>
        <Select value={연도} onValueChange={(v) => set연도(v ?? 전체연도)}>
          <SelectTrigger size="sm" className="h-7 w-24 text-[14.1px]" aria-label="수행 연도로 걸러내기">
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

        {/* 단계 필터는 **전체 보기에서만** 낸다. 단계 화면에서는 이미 그 단계만 있어서
            고를 것이 없다(누를 데 없는 컨트롤을 두지 않는다 — 「종료 숨기기」를 뺀 것과 같은 이유).
            ⚠ 드롭다운에서 **토글 칩**으로 바꿨다(2026-09-04 사용자 지시) — "신청중이랑 수행중만"처럼
            여러 개를 동시에 보는 게 실제 쓰임이라 하나만 고르는 컨트롤로는 안 됐다. */}
        {전체보기중 && (
          <div role="group" aria-label="단계로 걸러내기" className="flex items-center gap-1">
            {단계전체목록.map((s) => {
              const 켜짐 = 단계선택.has(s)
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={켜짐}
                  onClick={() => 단계토글(s)}
                  className={
                    "h-7 rounded-md border px-2.5 text-[14.1px] transition-colors " +
                    (켜짐
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60")
                  }
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}

        {유형목록.length > 1 && (
          <Select value={유형} onValueChange={(v) => set유형(v ?? 모두)}>
            <SelectTrigger size="sm" className="h-7 w-36 text-[14.1px]" aria-label="사업유형으로 걸러내기">
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

        {/* 기간 — 프리셋으로 대부분 끝나고, 안 맞으면 날짜를 직접 넣는다(집행 표와 같은 모양). */}
        <Select
          value={프리셋}
          onValueChange={(v) => {
            set프리셋(v ?? "전체")
            set기간시작("")
            set기간끝("")
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-32 text-[14.1px]" aria-label="기간 프리셋">
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
          onChange={(e) => {
            set기간시작(e.target.value)
            set프리셋("전체")
          }}
          className="h-7 w-[132px] text-[13.8px]"
          aria-label="기간 시작"
        />
        <span className="text-xs text-muted-foreground">~</span>
        <Input
          type="date"
          value={기간끝}
          onChange={(e) => {
            set기간끝(e.target.value)
            set프리셋("전체")
          }}
          className="h-7 w-[132px] text-[13.8px]"
          aria-label="기간 끝"
        />

        <Select value={String(크기)} onValueChange={(v) => set크기(Number(v))}>
          <SelectTrigger size="sm" className="h-7 w-24 text-[14.1px]" aria-label="한 쪽에 볼 개수">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {보기단위.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}개씩
              </SelectItem>
            ))}
            <SelectItem value={String(쪽없음)}>전체</SelectItem>
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
            className="ml-auto h-7 text-[14.1px]"
          >
            ↺ 초기화
          </Button>
        )}
      </div>

      {/* 수행기간이 끝났는데 저장된 상태가 아직 수행중인 건. 목록은 이미 여기로 옮겨 놨고,
          **저장값을 맞추는 것은 사람이 누른다** — 조회가 조용히 DB 를 고치면 기록이 사라진다. */}
      {밀린종료.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--warning-fg)]/30 bg-[var(--warning)] px-3 py-2 text-xs text-[var(--warning-fg)]">
          <span>
            수행기간이 끝났는데 상태가 아직 「수행중」인 과제가 {밀린종료.length}건 있습니다.
            목록에는 이미 사업종료로 옮겨 두었습니다.
          </span>
          <Button
            type="button"
            variant="outline"
            className="ml-auto h-7 bg-card text-[14.1px]"
            disabled={맞춤중}
            onClick={종료로맞추기}
          >
            {맞춤중 ? "기록 중…" : `${밀린종료.length}건 종료로 기록`}
          </Button>
        </div>
      )}

      {/* ⚠ 결과 문구는 **배너 밖**에 둔다. 다 맞추고 나면 배너가 사라지는데, 문구가 그 안에 있으면
          같이 사라져서 「눌렀는데 아무 말도 없다」가 된다. 실제로 그렇게 만들어 놨다가 고쳤다. */}
      {맞춤말 && <p className="px-1 text-xs text-muted-foreground">{맞춤말}</p>}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={
              단계 === "신청중"
                ? "신청 중인 과제가 없습니다"
                : 단계 === "신청완료"
                  ? "발표·심사 결과를 기다리는 과제가 없습니다"
                  : 단계 === "사업종료"
                    ? "종료된 과제가 없습니다"
                    : "수행 중인 과제가 없습니다"
            }
            hint={
              단계 === "신청중"
                ? "공고 탐색에서 [지원 등록]을 누르면 여기에 생깁니다. 발표·심사를 거치면 신청완료로 넘어갑니다."
                : 단계 === "신청완료"
                  ? "발표·심사가 기록되면 여기로 넘어옵니다. 선정을 기록하면 수행중으로 넘어갑니다."
                  : 단계 === "사업종료"
                    ? "수행기간이 끝나면 저절로 여기로 넘어옵니다."
                    : "공고에서 지원을 등록하고 선정되면 여기에 쌓입니다."
            }
          />
        ) : 필터된.length === 0 ? (
          <EmptyState
            title="조건에 맞는 과제가 없습니다"
            hint={`검색어나 연도를 바꿔 보세요. 다른 단계에 있는 과제라면 위 ${
              단계 === "수행중" ? "「신청중」·「사업종료」" : "단계 칩"
            }에서 찾습니다.`}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[240px]">과제명</TableHead>
                {/* 단계 열은 전체 보기에서만. 단계 화면에서는 열 하나가 같은 값으로 채워진다. */}
                {전체보기중 && <TableHead className="w-[84px]">단계</TableHead>}
                <TableHead>과제코드</TableHead>
                <TableHead className="w-[116px]">연구책임자</TableHead>
                <TableHead>부처 / 전문기관</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>수행기간</TableHead>
                {/* 머리글을 짧게. 뜻은 title 로 남긴다 — 「연차 (현재/총)」이 열 하나를 90px 잡아먹었다. */}
                <TableHead className="text-right" title="현재 연차 / 총 연차">
                  연차
                </TableHead>
                {/* 두 숫자를 한 칸에 위아래로 둔다 — 늘 같이 읽는 값이고(정부/총 = 지원 비율),
                    나란히 놓으면 열 둘이 각각 115px 을 잡아 1,280px 에서 가로 스크롤이 남았다. */}
                <TableHead className="text-right" title="총사업비 / 정부지원금">
                  사업비
                </TableHead>
                <TableHead>상태</TableHead>
                {/* 액션 칸은 가운데 정렬이다 — 단계마다 링크가 하나씩 빠져서
                    오른쪽에 붙이면 남은 하나가 줄마다 다른 자리에 보인다(사용자 지시). */}
                <TableHead className="w-[84px] text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {보이는.map((r) => {
                // 끝난 과제는 줄 전체를 연빨강으로 칠한다(사용자 지시). 배지 하나로는
                // 열 줄 중 어느 게 끝난 건지 훑어서 안 잡힌다.
                // 줄 색·계상 링크도 **단계**를 본다. 저장값만 보면 기간이 끝났는데
                // 계상 링크가 살아 있다(단계는 사업종료로 넘어가 있는데도).
                const 단계이줄 = 단계별[r.id] ?? (r.상태 === "종료" ? "사업종료" : r.상태)
                const 끝남 = 단계이줄 === "사업종료"
                // 단계마다 할 수 있는 일이 다르다 — 종료는 계상이 없고, 신청중은 정산이 없다.
                const 계상가능 = !끝남
                const 정산가능 = 단계이줄 !== "신청중" && 단계이줄 !== "신청완료"
                return (
                  <TableRow
                    key={r.id}
                    className={"h-[38px] text-[14.3px] " + (상태색[단계이줄] ?? "")}
                  >
                    {/* ⚠ `TableCell` 기본값이 `whitespace-nowrap` 이라 긴 과제명이 한 줄로
                        펼쳐지며 `w-[240px]` 을 무시하고 표를 밀어냈다(1,618px → 가로 스크롤).
                        여기서만 줄바꿈을 허용한다 — 이름을 자르면 어느 과제인지 못 읽는다. */}
                    <TableCell className="font-semibold whitespace-normal">
                      {/* 계상·정산은 과제 안에서 한다. 목록은 어느 과제로 들어갈지만 고른다. */}
                      <Link
                        href={`/projects/${r.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.과제명}
                      </Link>
                      {/* ⚠ 열을 새로 늘리지 않는다 — 방금 폭을 줄여 가로 스크롤을 없앤 표다.
                          **바로 갈 수 있어야** 하므로 배지 자체가 그 과제의 집행 탭 링크다
                          (증빙 파일이 실제로 붙는 자리·2026-09-04 사용자 지시). */}
                      {증빙[r.id] && (
                        <Link
                          href={`/projects/${r.id}/expenses${증빙[r.id].빈집행ids[0] ? `?expense=${증빙[r.id].빈집행ids[0]}` : ""}`}
                          title={`집행 ${증빙[r.id].빈집행건}건에 필수 서류 ${증빙[r.id].빈칸}칸이 비었다 — 눌러서 가장 오래된 건부터 채웁니다`}
                          className="ml-1.5 inline-block rounded bg-[var(--warning)] px-1 py-0.5 align-middle text-[11.6px] font-medium whitespace-nowrap text-[var(--warning-fg)] underline-offset-2 hover:underline"
                        >
                          집행 {증빙[r.id].빈집행건}건 증빙 없음
                        </Link>
                      )}
                    </TableCell>
                    {전체보기중 && (
                      <TableCell className="text-[13.2px] text-muted-foreground">
                        {단계별[r.id] ?? "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-[13.8px] tabular-nums text-muted-foreground">
                      {r.과제코드 ?? "—"}
                    </TableCell>
                    {/* 눌러서 바로 고친다. 막는 판정은 서버 액션의 `수정권한()` 한 곳에서만 한다. */}
                    <TableCell className="text-[13.8px]">
                      <ProjectLeadCell
                        과제_id={r.id}
                        표시명={책임자[r.id] ?? null}
                        로그인={로그인}
                      />
                    </TableCell>
                    {/* 「중소벤처기업부 · 중소기업기술정보진흥원」이 한 줄로 펼쳐지면 열이 300px 를 넘는다.
                        두 줄로 접고 상한을 둔다. 자르지는 않는다 — 전문기관이 어디인지가 정산 창구다. */}
                    <TableCell className="max-w-[150px] whitespace-normal text-[13.8px] text-muted-foreground">
                      {r.부처 ?? "—"}
                      {r.전문기관 ? ` · ${r.전문기관}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.사업유형
                        ? (사업유형_짧게[r.사업유형] ?? 사업유형_라벨[r.사업유형] ?? r.사업유형)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-[13.8px] tabular-nums text-muted-foreground">
                      {r.시작일 ?? "확인 필요"}~{r.종료일 ?? "확인 필요"}
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
                    <TableCell className="text-right tabular-nums">
                      <div>{won(r.총사업비)}</div>
                      <div className="text-[12.7px] text-muted-foreground">
                        {r.정부지원금 == null ? "정부 확인 필요" : `정부 ${won(r.정부지원금)}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* ⚠ 저장된 `상태` 가 아니라 **단계**를 찍는다. 「단계」 열은 신청완료인데
                          여기는 신청중이라 한 줄이 서로 다른 말을 했다(사용자 지적).
                          신청완료는 `선정결과='발표심사'` 에서 나오고 저장된 상태는 그대로
                          '신청중' 이다 — 저장값이 틀린 게 아니라, 그걸 여기 보여 준 게 틀렸다. */}
                      <StatusBadge value={단계별[r.id] ?? r.상태} />
                    </TableCell>
                    <TableCell className="text-center">
                      {/* 단계마다 할 수 있는 일이 다르다. 못 하는 일의 링크를 걸어 두면
                          「여기서 뭘 해야 하나」를 잘못 알려 준다(`components/project-tabs.tsx` 와 같은 표).
                            · 종료 → 계상 없음(계상은 협약·수행 중에 하는 일)
                            · 신청중 → 정산 없음(선정도 안 됐는데 정산할 것이 없다) */}
                      {/* ⚠ 구분자는 **양쪽이 다 보일 때만** 찍는다. 계상 쪽에 붙여 두면
                          정산이 빠지는 신청중 줄이 「계상 ·」로 끝난다(사용자 지적). */}
                      {계상가능 && (
                        <Link
                          href={`/projects/${r.id}/budget`}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          계상
                        </Link>
                      )}
                      {계상가능 && 정산가능 && (
                        <span className="px-1.5 text-xs text-muted-foreground">·</span>
                      )}
                      {정산가능 && (
                        <Link
                          href={`/projects/${r.id}/settlement`}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          정산
                        </Link>
                      )}
                      {/* 단계를 앞으로 옮기는 버튼. 신청을 냈다 · 선정됐다는 **날짜로 알 수 없어서**
                          사람이 누른다(2026-09-04 사용자 지시). 지원사업 대장과 같은 컴포넌트다.
                          ⚠ 단계는 **서버가 판정해 넘긴 것**(`단계별`)을 쓴다. 여기서 다시
                          판정하면 두 곳에서 규칙이 갈리고, ProjectRow 엔 선정결과도 없다. */}
                      {단계별[r.id] && (
                        <div className="mt-0.5">
                          <StageAdvance 과제_id={r.id} 단계={단계별[r.id]} />
                        </div>
                      )}
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
            {쪽수 === 1 && 크기 !== 쪽없음 && ` · 한 쪽에 다 들어갑니다`}
          </span>
          <div className={쪽수 > 1 ? "ml-auto flex items-center gap-1" : "hidden"}>
            <Button
              type="button"
              variant="outline"
              className="h-7 text-[14.1px]"
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
              className="h-7 text-[14.1px]"
              disabled={지금쪽 >= 쪽수}
              onClick={() => set쪽((v) => Math.min(쪽수, v + 1))}
            >
              다음 ›
            </Button>
          </div>
        </div>
      )}

      {/* 색이 무엇을 뜻하는지 화면에 적어 둔다. 안 적으면 빨강을 「문제 있는 과제」로 읽는다.
          지금 보이는 줄에 실제로 있는 색만 적는다 — 단계 화면(신청중만·수행중만·종료만)에서는
          한 가지 색만 뜨니 나머지 둘을 굳이 설명하지 않는다. */}
      {상태색_범례.some((s) => 보이는.some((r) => (단계별[r.id] ?? r.상태) === s.상태)) && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {상태색_범례
            .filter((s) => 보이는.some((r) => (단계별[r.id] ?? r.상태) === s.상태))
            .map((s) => (
              <span key={s.상태} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-5 rounded-sm border ${s.스와치}`} />
                <span className="text-foreground">{s.이름}</span>
                {s.설명}
              </span>
            ))}
        </p>
      )}
    </>
  )
}
