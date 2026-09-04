"use client"

import * as React from "react"
import Link from "next/link"
import { Star, RefreshCw, CheckCircle2, AlertCircle, Building2, RotateCcw } from "lucide-react"
import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { cn } from "@/lib/utils"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import { StatusBadge } from "@/components/status-badge"
import { DeadlineBadge } from "@/components/deadline-badge"
import { syncBizinfo } from "@/app/actions/announcements"
import { setAnnouncementInterest } from "@/app/actions/watchlist"
import type { AnnouncementRow } from "@/lib/queries"

// base-ui Select.Value 는 선택 항목의 라벨이 아니라 value 문자열 자체를 그대로 보여준다 —
// 그래서 "전체" 항목마다 값 자체를 온전한 라벨로 둔다(공유 상수 하나를 쓰면 트리거에
// "전체"만 짧게 뜬다. 실측으로 확인함).
const 전체_주관기관 = "전체 주관기관"
const 전체_마감유형 = "전체 마감유형"
const 전체_자격판정 = "전체 자격판정"
const 전체_지역 = "전체 지역"
const 전체_관심상태 = "전체(관심·신청예정 모두)"

/** 기업마당 출처_id 는 PBLN_000000000126145 형태 — 공고번호 칸엔 숫자만 남겨 #126145 로 보여준다. */
function 공고번호표시(출처_id: string | null): string {
  if (!출처_id) return "—"
  const m = /^PBLN_0*(\d+)$/.exec(출처_id)
  return m ? `#${m[1]}` : 출처_id
}

/** 기업마당 목록 동기화. 지원사업(/announcements) 전용 — 과제사업은 IRIS·NTIS 수집기가 따로 있다. */
export function SyncButton() {
  const [state, setState] = React.useState<"idle" | "loading" | "done" | "error">("idle")
  const [message, setMessage] = React.useState<string | null>(null)

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-7 text-[14.1px]"
        disabled={state === "loading"}
        title="기업마당 오픈API에서 목록만 다시 받는다. 서류 판독은 서버의 별도 배치가 처리한다."
        onClick={async () => {
          setState("loading")
          setMessage(null)
          const r = await syncBizinfo()
          if (r.ok) {
            setState("done")
            setMessage(`${r.처리건수 ?? 0}건 확인`)
          } else {
            setState("error")
            setMessage(r.error ?? "동기화 실패")
          }
        }}
      >
        <RefreshCw className={cn("size-3.5", state === "loading" && "animate-spin")} />
        {state === "loading" ? "동기화 중…" : "동기화"}
      </Button>
      {message && (
        <span
          className={cn(
            "flex items-center gap-1 text-xs",
            state === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {state === "error" ? (
            <AlertCircle className="size-3.5" />
          ) : (
            <CheckCircle2 className="size-3.5 text-[var(--success-fg)]" />
          )}
          {message}
        </span>
      )}
    </div>
  )
}

export function AnnouncementsExplorer({
  rows,
  error,
  banner,
  footer,
  title = "공고 탐색",
  description = "공고문을 넣으면 자격 요건·제출 서류·계상 규칙을 뽑아 우리 것과 대조한다.",
  actions,
  showSource = false,
  detailBasePath,
  emptyHint = "동기화를 누르면 기업마당 API 목록이 채워집니다.",
  referenceRows = [],
  referenceLabel,
}: {
  rows: AnnouncementRow[]
  error: string | null
  banner: string
  footer?: React.ReactNode
  title?: string
  description?: string
  /** 기본은 동기화 버튼(지원사업 전용). 과제사업 등 다른 화면은 직접 넘기거나 생략한다. */
  actions?: React.ReactNode
  /** 출처가 둘 이상 섞이는 화면(과제사업의 IRIS·NTIS)에서 사업명 앞에 출처 배지를 붙인다. */
  showSource?: boolean
  /** 있으면 사업명이 `${detailBasePath}/${id}` 링크가 된다. 없으면 그냥 텍스트(지원사업은 상세 화면이 아직 없다). */
  detailBasePath?: string
  emptyHint?: string
  /**
   * 필터에 안 걸리는 별도 구간 — 과제사업의 NTIS 참고자료(접수 개념이 없는 과제 메타정보)처럼
   * "공고가 아니라서 지우진 않지만 같은 무게로 섞으면 안 되는" 행. 항상 흐리게, 구분선 아래 그대로 보여준다.
   */
  referenceRows?: AnnouncementRow[]
  referenceLabel?: string
}) {
  const [search, setSearch] = React.useState("")
  const [소관부처, set소관부처] = React.useState(전체_주관기관)
  const [마감유형, set마감유형] = React.useState(전체_마감유형)
  const [자격판정, set자격판정] = React.useState(전체_자격판정)
  const [지역, set지역] = React.useState(전체_지역)
  // 사람이 별로 표시한 단계(관심·신청예정)만 걸러 본다 — 자격판정 필터와는 완전히 별개 축.
  const [관심상태, set관심상태] = React.useState(전체_관심상태)
  // 기본은 자사 기준(회사 정보로 걸러진 후보만) — "목록만"은 collect-bizinfo.mjs 의
  // 1차 거르기(selectRelevant)에서 회사와 안 맞아 보여 첨부를 안 받은 행이다.
  // 꺼서 전체(자사 기준에서 빠진 것 포함)를 볼 수 있게 둔다 — 지우지 않고 숨기기만 한다.
  const [자사기준만, set자사기준만] = React.useState(true)

  const 소관부처목록 = React.useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.소관부처).filter((v): v is string => !!v))).sort(),
    [rows],
  )
  const 지역목록 = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.지역).filter((v): v is string => !!v))).sort(),
    [rows],
  )
  const 마감유형목록 = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.마감유형))).sort(),
    [rows],
  )

  const 자사기준통과 = (r: AnnouncementRow) => r.파싱상태 !== "목록만"
  const 자사건수 = React.useMemo(() => rows.filter(자사기준통과).length, [rows])
  // 관련공고 = 회사 프로필과 대조해 「가능」으로 판정된 공고 — 계산·AI 가 매긴 것이다.
  // 사람이 손으로 누르는 관심 표시(WatchStar, app.watchlist)와는 다른 개념이라 이름을
  // 가른다(2026-09-03, 둘 다 "관심공고"였다가 헷갈려서 이쪽을 "관련공고"로 바꿨다).
  // 다른 필터와 무관하게 전체 rows 기준으로 센다 — 지금 어떤 필터가 걸려 있든
  // "진짜 매치 수"를 그대로 보여준다.
  const 관련공고건수 = React.useMemo(
    () => rows.filter((r) => r.자격판정 === "가능").length,
    [rows],
  )
  const 관련공고보는중 = 자격판정 === "가능"

  const filtered = rows.filter((r) => {
    if (자사기준만 && !자사기준통과(r)) return false
    if (소관부처 !== 전체_주관기관 && r.소관부처 !== 소관부처) return false
    if (마감유형 !== 전체_마감유형 && r.마감유형 !== 마감유형) return false
    if (자격판정 !== 전체_자격판정 && r.자격판정 !== 자격판정) return false
    if (지역 !== 전체_지역 && r.지역 !== 지역) return false
    if (관심상태 !== 전체_관심상태 && r.관심상태 !== 관심상태) return false
    if (search.trim()) {
      const q = search.trim()
      const 대상 = `${r.사업명} ${r.소관부처 ?? ""} ${r.전문기관 ?? ""}`
      if (!대상.includes(q)) return false
    }
    return true
  })

  return (
    <PageShell
      title={title}
      description={description}
      actions={actions}
      filters={
        <>
          <Select value={소관부처} onValueChange={(v) => set소관부처(v ?? 전체_주관기관)}>
            <SelectTrigger size="sm" className="text-[14.1px]">
              <SelectValue placeholder="전체 주관기관" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={전체_주관기관}>전체 주관기관</SelectItem>
              {소관부처목록.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={마감유형} onValueChange={(v) => set마감유형(v ?? 전체_마감유형)}>
            <SelectTrigger size="sm" className="text-[14.1px]">
              <SelectValue placeholder="전체 마감유형" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={전체_마감유형}>전체 마감유형</SelectItem>
              {마감유형목록.map((v) => (
                <SelectItem key={v} value={v}>
                  {v === "dated" ? "날짜형" : v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={자격판정} onValueChange={(v) => set자격판정(v ?? 전체_자격판정)}>
            <SelectTrigger size="sm" className="text-[14.1px]">
              <SelectValue placeholder="전체 자격판정" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={전체_자격판정}>전체 자격판정</SelectItem>
              <SelectItem value="가능">가능</SelectItem>
              <SelectItem value="불가">불가</SelectItem>
              <SelectItem value="확인필요">확인필요</SelectItem>
              <SelectItem value="요건미확인">요건미확인</SelectItem>
            </SelectContent>
          </Select>

          <Select value={지역} onValueChange={(v) => set지역(v ?? 전체_지역)}>
            <SelectTrigger size="sm" className="text-[14.1px]">
              <SelectValue placeholder="전체 지역" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={전체_지역}>전체 지역</SelectItem>
              {지역목록.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={관심상태} onValueChange={(v) => set관심상태(v ?? 전체_관심상태)}>
            <SelectTrigger size="sm" className="text-[14.1px]">
              <SelectValue placeholder={전체_관심상태} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={전체_관심상태}>{전체_관심상태}</SelectItem>
              <SelectItem value="관심">관심</SelectItem>
              <SelectItem value="신청예정">신청예정</SelectItem>
              <SelectItem value="신청완료">신청완료</SelectItem>
            </SelectContent>
          </Select>

          <Input
            placeholder="사업명·기관 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-56 text-[14.3px]"
          />

          <Button
            type="button"
            variant={자사기준만 ? "default" : "outline"}
            className="h-7 text-[14.1px]"
            title="회사 정보(company_profile)로 걸러진 후보만 본다. 끄면 걸러져서 목록만 저장된(첨부 안 받은) 공고까지 다 보인다."
            onClick={() => set자사기준만((v) => !v)}
          >
            <Building2 className="size-3.5" />
            {자사기준만 ? `자사 기준 ${자사건수}건` : "전체 공고 보기"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="ml-auto h-7 text-[14.1px]"
            onClick={() => {
              setSearch("")
              set소관부처(전체_주관기관)
              set마감유형(전체_마감유형)
              set자격판정(전체_자격판정)
              set지역(전체_지역)
              set관심상태(전체_관심상태)
              set자사기준만(true)
            }}
          >
            <RotateCcw className="size-3.5" />
            초기화
          </Button>
        </>
      }
    >
      {error && <DbError what={`${title} 목록`} error={error} />}

      {/*
       * 관련공고 — 회사 프로필과 대조해 「가능」으로 판정된 공고. 목록 맨 위, 눈에 띄게
       * (사용자 요청, 2026-09-03: "회사 프로필 기준으로 관심공고도 나타나게" → 이후
       * 사람이 손으로 누르는 관심 표시(별)가 따로 생기면서 이름이 겹쳐 "관련공고"로
       * 정정했다 — 계산/AI 가 매긴 것과 사람이 정한 것을 이름부터 가른다).
       * 자격판정 드롭다운에서 「가능」을 고르는 것과 같은 필터를 누르지만, 드롭다운 안에
       * 묻혀 있으면 회사 프로필을 채워도 아무도 못 알아챈다 — 그래서 카드로 꺼내 둔다.
       * 0건이면 카드 자체를 안 그린다(대시보드 큐 카드와 같은 원칙 — 항상 켜진 표시는
       * 표시가 아니다). 누르면 켜지고, 다시 누르면 꺼진다(토글).
       */}
      {!error && 관련공고건수 > 0 && (
        <button
          type="button"
          onClick={() => set자격판정(관련공고보는중 ? 전체_자격판정 : "가능")}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border p-4 text-left shadow-sm transition-colors",
            관련공고보는중
              ? "border-[var(--success-fg)]/30 bg-[var(--success)] text-[var(--success-fg)]"
              : "border-[var(--success-fg)]/20 bg-[var(--success)]/40 hover:bg-[var(--success)]",
          )}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--success-fg)] text-white">
            <Star className="size-5" fill="currentColor" strokeWidth={0} />
          </div>
          <div className="flex-1">
            <div className="text-base font-bold">관련 공고 {관련공고건수}건</div>
            <div className="text-xs font-medium opacity-80">
              회사 프로필(지역·업종·규모 등) 기준으로 신청 가능하다고 판정된 공고입니다.
              {관련공고보는중 ? " 눌러서 전체 목록으로 돌아가기." : " 눌러서 이 공고만 보기."}
            </div>
          </div>
        </button>
      )}

      <Card>
        {filtered.length === 0 && referenceRows.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? "아직 수집된 공고가 없습니다" : "조건에 맞는 공고가 없습니다"}
            hint={
              rows.length === 0
                ? emptyHint
                : 자사기준만 && 자사건수 === 0
                  ? "회사 정보로 걸러진 공고가 아직 없습니다 — 「전체 공고 보기」를 눌러 전체를 확인하세요."
                  : "필터를 초기화해 보세요."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[36px] p-0 text-center" title="관심 표시">
                  <Star className="mx-auto size-3.5 text-muted-foreground/40" />
                </TableHead>
                <TableHead className="w-[90px]">공고번호</TableHead>
                <TableHead>사업명</TableHead>
                <TableHead className="w-[220px]">주관기관</TableHead>
                <TableHead className="w-[110px]">접수마감</TableHead>
                {/* 2026-09-04 심사용 최종본 — 90px 이던 걸 116px 로 늘렸다. 전역 폰트
                    110% 확대 뒤 가장 긴 라벨("요건미확인" 배지, 실측 82px)이 셀
                    padding(양쪽 각 8.8px)을 더한 90px 칸보다 넓어져서, 표 맨 오른쪽
                    끝 칸이라 배지가 표 테두리 밖으로 살짝 넘쳤다(사용자 지적,
                    "끝 선이랑 겹치잖아"). */}
                <TableHead className="w-[116px]">자격판정</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    조건에 맞는 공고가 없습니다. 필터를 초기화해 보세요.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((a) => (
                  <Row key={a.id} a={a} showSource={showSource} detailBasePath={detailBasePath} />
                ))
              )}

              {referenceRows.length > 0 && (
                <>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="h-7 py-1 text-xs text-muted-foreground">
                      {referenceLabel ?? `참고 ${referenceRows.length}건`}
                    </TableCell>
                  </TableRow>
                  {referenceRows.map((a) => (
                    <Row
                      key={a.id}
                      a={a}
                      showSource={showSource}
                      detailBasePath={detailBasePath}
                      dim
                    />
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {footer}
    </PageShell>
  )
}

type 관심상태 = "관심" | "신청예정" | "신청완료" | null

/**
 * 관심 표시 별 — 자격판정(계산·AI)과 완전히 별개인, 사람이 손으로 누른 표시
 * (app.watchlist, 종류='공고'). 목록에서 별은 **관심 ↔ 없음** 만 오간다.
 * 신청예정·신청완료로 올리는 것도, 내리는 것도 **공고 상세의 전용 버튼(ApplyStatus)** 몫이다.
 *
 * ⚠ 전에는 「비었으면 관심, 아니면 지움」이라 **신청완료인 공고의 별을 누르면 신청 표시가
 *   통째로 지워졌다**(2026-09-04 사용자 지적: "별을 클릭하면 신청이 취소되버리는 문제").
 *   표 안의 작은 별이고 줄을 누르면 상세로 넘어가는 화면이라 스치듯 눌리기 딱 좋은 자리다.
 *   올릴 때 상세까지 들어가 두 걸음 걸린 것을 목록에서 한 번에 내리게 두면 안 된다 —
 *   게다가 이건 「한 일을 안 한 일로 되돌리는」 쪽이라 더 조심해야 한다.
 *
 * 낙관적으로 먼저 칠하고, 서버가 실패를 돌려주면 되돌린다.
 */
function WatchStar({ id, initial }: { id: number; initial: 관심상태 }) {
  const [상태, set상태] = React.useState(initial)
  const [pending, start] = React.useTransition()

  React.useEffect(() => set상태(initial), [initial])

  /** 신청 단계까지 올라간 공고. 여기서는 **손대지 않는다** — 올린 자리에서만 내린다. */
  const 신청단계 = 상태 === "신청예정" || 상태 === "신청완료"
  const 다음: 관심상태 = 상태 === null ? "관심" : null
  const label = 신청단계
    ? `${상태} — 공고 상세에서 바꾼다(별로는 지워지지 않는다)`
    : 상태 === null
      ? "관심 공고로 표시"
      : "관심 표시 지우기"

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // ⚠ `disabled` 를 쓰지 않는다 — 칠해진 별이 흐려져 「신청완료가 풀렸나」로 읽힌다.
      //    누를 수는 있되 아무 일도 안 일어난다는 것을 커서와 title 로 알린다.
      //    무슨 상태인지는 같은 줄의 배지가 이미 말하고 있다.
      aria-disabled={신청단계 || undefined}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (신청단계) return
        const prev = 상태
        set상태(다음)
        start(async () => {
          const r = await setAnnouncementInterest(id, 다음)
          if (!r.ok) set상태(prev)
        })
      }}
      className={cn(
        "flex size-full items-center justify-center py-2 disabled:opacity-50",
        신청단계 ? "cursor-default" : "hover:bg-muted",
      )}
    >
      <Star
        className={cn(
          "size-4",
          상태 === "관심" && "fill-[var(--warning-fg)] text-[var(--warning-fg)]",
          상태 === "신청예정" && "fill-[var(--success-fg)] text-[var(--success-fg)]",
          상태 === "신청완료" && "fill-primary text-primary",
          상태 === null && "text-muted-foreground/40",
        )}
      />
    </button>
  )
}

/**
 * 표 한 줄. `dim` 은 참고 구간용 — 같은 무게로 보이면 구분선을 그은 뜻이 없다.
 *
 * 사업명을 누르면 슬라이드 패널이 아니라 **새 페이지**(`${detailBasePath}/${a.id}`)로
 * 넘어간다 — 사용자 요청(2026-09-03): 요약·자격판정과 요구서류 체크리스트가 따로
 * 놀지 않고 한 화면에서 다 보이게. `detailBasePath` 가 없는 화면(아직 상세 라우트가
 * 없는 경우)은 안전하게 텍스트로만 둔다 — 없는 링크를 만들지 않는다.
 */
function Row({
  a,
  showSource,
  detailBasePath,
  dim,
}: {
  a: AnnouncementRow
  showSource: boolean
  detailBasePath?: string
  dim?: boolean
}) {
  const 이름 = (
    <>
      {showSource && (
        <span className="mr-1.5 text-xs font-normal text-muted-foreground">[{a.출처}]</span>
      )}
      {a.사업명}
    </>
  )

  return (
    <TableRow className={`h-[38px] text-[14.3px] ${dim ? "opacity-60" : ""}`}>
      <TableCell className="p-0 text-center">
        <WatchStar id={a.id} initial={a.관심상태 ?? null} />
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {공고번호표시(a.출처_id)}
      </TableCell>
      <TableCell className="font-medium">
        {detailBasePath ? (
          <Link href={`${detailBasePath}/${a.id}`} className="hover:underline">
            {이름}
          </Link>
        ) : (
          이름
        )}
        {a.관심상태 === "관심" && (
          <Badge
            variant="outline"
            className="ml-2 h-5 rounded-4xl bg-[var(--warning)] px-2 text-xs font-medium text-[var(--warning-fg)]"
          >
            관심
          </Badge>
        )}
        {a.관심상태 === "신청예정" && (
          <Badge
            variant="outline"
            className="ml-2 h-5 rounded-4xl bg-[var(--success)] px-2 text-xs font-medium text-[var(--success-fg)]"
          >
            신청예정
          </Badge>
        )}
        {a.관심상태 === "신청완료" && (
          <Badge
            variant="outline"
            className="ml-2 h-5 rounded-4xl bg-primary/10 px-2 text-xs font-medium text-primary"
          >
            신청완료
          </Badge>
        )}
        {a.중복후보 && (
          <Badge
            variant="outline"
            className="ml-2 h-5 rounded-4xl bg-[var(--warning)] px-2 text-xs font-medium text-[var(--warning-fg)]"
          >
            중복 후보
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {a.소관부처 ?? a.전문기관 ?? "—"}
      </TableCell>
      <TableCell>
        <DeadlineBadge 마감유형={a.마감유형} 접수종료={a.접수종료} />
      </TableCell>
      <TableCell>
        <StatusBadge value={a.자격판정} />
      </TableCell>
    </TableRow>
  )
}
