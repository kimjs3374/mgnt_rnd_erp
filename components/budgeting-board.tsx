"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { 협약금액_확정 } from "@/app/actions/project-budgeting"
import type { BudgetingRow, 계상단계 } from "@/lib/queries-budgeting"

/**
 * 과제 계상 — **선정된 과제를 계상까지 밀어 넣는 작업 화면**.
 *
 * 공고 → 지원 등록 → 선정 → **여기** → 연구비 계상 탭.
 *
 * [지원 등록]이 만드는 줄은 총사업비가 **0** 이다(협약 전이라 금액이 없다).
 * 선정이 나면 그 0을 협약 금액으로 바꿔야 하는데, 그 전에는 **비목을 나눌 기준 자체가 없어서**
 * 계상 화면에 가도 할 수 있는 일이 없다. 그 끊긴 자리를 잇는 것이 이 화면의 전부다.
 *
 * ⚠ 비목 배정 자체는 여기서 하지 않는다 — 그건 `/projects/[id]/budget` 이 이미 한다.
 *   같은 일을 두 화면에서 다르게 하면 한쪽만 고쳐지고 그 사고는 시연장에서 드러난다.
 *   여기는 **어디까지 왔는지 보여주고 다음 자리로 보내는 일**만 한다.
 */

const 원 = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString("ko-KR")

/** 숫자칸 — 사람은 137,000,000 으로 친다. 콤마를 지우고 읽는다. */
function 수(v: string): number | null {
  const s = v.replace(/[,\s]/g, "")
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const 단계색: Record<계상단계, string> = {
  사업비_미확정: "bg-[var(--warning)] text-[var(--warning-fg)]",
  미계상: "bg-[var(--warning)] text-[var(--warning-fg)]",
  초과: "bg-destructive/15 text-destructive",
  진행중: "bg-secondary text-foreground",
  완료: "border border-border text-muted-foreground",
  확정: "border border-primary text-primary",
}

function StageBadge({ 단계, 이름 }: { 단계: 계상단계; 이름: string }) {
  return (
    <span
      className={
        "inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium " +
        단계색[단계]
      }
    >
      {이름}
    </span>
  )
}

export function BudgetingBoard({
  rows,
  단계이름,
  기관유형,
}: {
  rows: BudgetingRow[]
  단계이름: Record<계상단계, string>
  기관유형: string | null
}) {
  const router = useRouter()
  const [대상, set대상] = React.useState<BudgetingRow | null>(null)
  const [검색, set검색] = React.useState("")
  const [단계필터, set단계필터] = React.useState<계상단계 | "전체" | "미완료" | "신청단계">("전체")

  /**
   * 검색은 **화면에서** 거른다. 선정 과제는 많아야 수십 건이라 서버를 다시 다녀올 이유가 없고,
   * 한 글자마다 서버 액션을 부르면 대회장 네트워크에서 눈에 띄게 느려진다.
   * 찾는 대상은 과제명·과제코드·**공고명**까지다 — 「그 공고로 받은 과제가 뭐였지」가 실제 질문이다.
   */
  const 걸러진 = React.useMemo(() => {
    const q = 검색.trim().toLowerCase()
    return rows.filter((r) => {
      // 「손이 필요한 것만」에서는 완료와 **확정**을 뺀다. 확정은 관리 위치가 대장으로 넘어간 건이다.
      // 「신청 단계만」은 단계가 아니라 **선정 전인가**로 거른다 — 축이 다르므로 따로 본다.
      if (
        단계필터 === "미완료"
          ? r.단계 === "완료" || r.단계 === "확정"
          : 단계필터 === "신청단계"
            ? !r.신청단계
            : 단계필터 !== "전체" && r.단계 !== 단계필터
      ) {
        return false
      }
      if (!q) return true
      return [r.과제명, r.과제코드 ?? "", r.공고명 ?? ""].some((v) => v.toLowerCase().includes(q))
    })
  }, [rows, 검색, 단계필터])

  const 단계옵션: (계상단계 | "전체" | "미완료" | "신청단계")[] = [
    "전체",
    "미완료",
    "신청단계",
    "사업비_미확정",
    "미계상",
    "진행중",
    "초과",
    "완료",
    "확정",
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input
          placeholder="과제명 · 과제코드 · 공고명 검색"
          className="h-7 w-72 text-[13px]"
          value={검색}
          onChange={(e) => set검색(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">단계</span>
        <select
          className="h-7 rounded-md border bg-background px-2 text-[12.5px]"
          value={단계필터}
          onChange={(e) => set단계필터(e.target.value as 계상단계 | "전체" | "미완료" | "신청단계")}
        >
          {단계옵션.map((v) => (
            <option key={v} value={v}>
              {v === "전체"
                ? "전체"
                : v === "미완료"
                  ? "손이 필요한 것만"
                  : v === "신청단계"
                    ? "신청 단계만 (선정 전)"
                    : 단계이름[v]}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground tabular-nums">
          {걸러진.length}/{rows.length}건
        </span>
        {(검색 || 단계필터 !== "전체") && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto h-7 text-[12.8px]"
            onClick={() => {
              set검색("")
              set단계필터("전체")
            }}
          >
            ↺ 초기화
          </Button>
        )}
      </div>

      {걸러진.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-muted-foreground">
          조건에 맞는 과제가 없습니다. 검색어나 단계를 바꿔 보세요.
        </p>
      ) : (
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[240px]">과제명</TableHead>
            <TableHead>출처</TableHead>
            <TableHead className="text-right">총사업비</TableHead>
            <TableHead className="text-right">계상 합계</TableHead>
            <TableHead className="text-right">남은 금액</TableHead>
            <TableHead>단계</TableHead>
            <TableHead className="w-[150px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {걸러진.map((r) => (
            <TableRow key={r.id} className="h-[38px] text-[13px]">
              {/* ⚠ `TableCell` 기본값이 `whitespace-nowrap` 이라 과제명이 416px 까지 펴져
                  표가 창을 넘겼다(1,280px 실측). 여기서만 줄바꿈을 허용한다. */}
              <TableCell className="font-medium whitespace-normal">
                <Link href={`/projects/${r.id}`} className="underline-offset-2 hover:underline">
                  {r.과제명}
                </Link>
                {/* 선정 전 건임을 줄에서 바로 알아야 한다 — 같은 표에 협약 계상과 섞여 있다. */}
                {r.신청단계 && (
                  <span
                    className="ml-1.5 rounded bg-[var(--warning)] px-1 py-0.5 text-[10.5px] text-[var(--warning-fg)]"
                    title="아직 선정 전입니다. 여기 잡는 금액은 신청서에 넣는 계획이고, 선정 뒤 협약 금액으로 다시 맞춥니다."
                  >
                    신청
                  </span>
                )}
                <div className="text-[11px] text-muted-foreground">{r.과제코드 ?? "—"}</div>
              </TableCell>

              <TableCell className="text-[12px] text-muted-foreground">
                {/* 공고에서 온 건은 그 공고의 규정이 적용된다 — 이게 「연동」의 실체다. */}
                {r.공고_id != null ? (
                  <>
                    <Link
                      href={`/project-announcements/${r.공고_id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.공고명 ?? `공고 ${r.공고_id}`}
                    </Link>
                    <div className="text-[11px] text-primary">공고 규정 적용</div>
                  </>
                ) : (
                  <>
                    직접 등록
                    <div className="text-[11px]">
                      {r.제안 ? "규정 기본값 적용" : "적용 규칙 없음"}
                    </div>
                  </>
                )}
              </TableCell>

              <TableCell className="text-right tabular-nums">
                {r.총사업비 > 0 ? 원(r.총사업비) : <span className="text-[var(--warning-fg)]">미정</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{원(r.배정합)}</TableCell>
              <TableCell
                className={
                  "text-right tabular-nums " +
                  (r.남은액 < 0 ? "text-destructive" : r.남은액 > 0 ? "text-[var(--warning-fg)]" : "text-muted-foreground")
                }
              >
                {r.총사업비 > 0 ? 원(r.남은액) : "—"}
              </TableCell>

              <TableCell>
                <StageBadge 단계={r.단계} 이름={단계이름[r.단계]} />
              </TableCell>

              <TableCell className="text-right">
                {r.단계 === "사업비_미확정" ? (
                  <Button
                    type="button"
                    className="h-7 text-[12.5px]"
                    onClick={() => set대상(r)}
                  >
                    {/* 선정 전에는 확정할 협약이 없다. 내가 써낼 금액을 넣는 일이다. */}
                    {r.신청단계 ? "신청 금액 입력" : "협약금액 확정"}
                  </Button>
                ) : r.단계 === "확정" ? (
                  // 확정된 건의 관리 위치는 대장이다. 계상 탭이 아니라 그쪽으로 보낸다.
                  <Link
                    href="/projects"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    사업 대장에서 보기
                  </Link>
                ) : (
                  <Link
                    href={`/projects/${r.id}/budget`}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {r.단계 === "완료" ? "계상 보기" : "계상하러 가기"}
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}

      {대상 && (
        <ContractAmountDialog
          row={대상}
          기관유형={기관유형}
          onClose={() => set대상(null)}
          onSaved={(id) => {
            set대상(null)
            router.push(`/projects/${id}/budget`)
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------------- */

/**
 * 협약 총사업비를 넣고 → **그 공고 규정으로 나눈 값을 미리 보고** → 저장한다.
 *
 * 계산은 서버에서 한다(`협약금액_확정({미리보기: true})`). 화면이 따로 계산하면
 * 저장되는 값과 보여준 값이 갈릴 수 있고, 그 어긋남은 정산에서야 드러난다.
 */
function ContractAmountDialog({
  row,
  기관유형,
  onClose,
  onSaved,
}: {
  row: BudgetingRow
  기관유형: string | null
  onClose: () => void
  onSaved: (id: number) => void
}) {
  const [금액, set금액] = React.useState("")
  const [pending, start] = React.useTransition()
  const [err, setErr] = React.useState<string | null>(null)
  const [미리보기, set미리보기] = React.useState<{
    근거: string[]
    주의: string[]
    채운값: { 정부지원금: number | null; 기관부담_현금: number | null; 기관부담_현물: number | null }
  } | null>(null)

  const 값 = 수(금액)
  const 낼수있나 = 값 != null && 값 > 0 && !pending

  // 금액을 고치면 앞의 미리보기는 거짓이 된다. 지운다.
  React.useEffect(() => {
    set미리보기(null)
    setErr(null)
  }, [금액])

  function 계산() {
    if (값 == null) return
    start(async () => {
      const r = await 협약금액_확정({ 과제_id: row.id, 총사업비: 값, 미리보기: true })
      if (!r.ok) {
        setErr(r.error ?? "계산하지 못했습니다.")
        return
      }
      set미리보기({ 근거: r.근거 ?? [], 주의: r.주의 ?? [], 채운값: r.채운값 ?? { 정부지원금: null, 기관부담_현금: null, 기관부담_현물: null } })
    })
  }

  function 저장() {
    if (값 == null) return
    start(async () => {
      const r = await 협약금액_확정({ 과제_id: row.id, 총사업비: 값 })
      if (!r.ok) {
        setErr(r.error ?? "저장하지 못했습니다.")
        return
      }
      onSaved(row.id)
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">협약금액 확정</DialogTitle>
          <DialogDescription>
            {row.과제명}
            {row.공고명 ? ` · ${row.공고명}` : ""}
          </DialogDescription>
        </DialogHeader>

        <p className="text-[12.5px] text-muted-foreground">
          지원 등록 때는 협약 전이라 총사업비가 0으로 들어갑니다. 협약 금액을 넣으면{" "}
          {row.공고_id != null ? (
            <b className="text-foreground">이 공고의 재원 분담 규정</b>
          ) : (
            <b className="text-foreground">기관유형 규정 기본값</b>
          )}
          으로 정부출연금·민간부담을 나눠 채웁니다. 그다음부터 비목을 계상할 수 있습니다.
        </p>

        <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
          <span>
            협약 총사업비 <span className="text-destructive">*</span>{" "}
            <span className="text-[10.5px]">원 · 협약서에 적힌 금액 그대로</span>
          </span>
          <Input
            className="h-8 text-[13px]"
            value={금액}
            onChange={(e) => set금액(e.target.value)}
            placeholder="137,000,000"
          />
        </label>

        {기관유형 == null && (
          <span className="text-[12px] text-[var(--warning-fg)]">
            회사 프로필에 기업규모가 없어 규정을 고를 수 없습니다 — 총사업비만 저장됩니다.
          </span>
        )}

        {미리보기 && (
          <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div className="grid grid-cols-3 gap-2 text-[12.5px]">
              <div>
                <div className="text-[11px] text-muted-foreground">정부출연금</div>
                <div className="tabular-nums">{원(미리보기.채운값.정부지원금)}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">민간부담 현금</div>
                <div className="tabular-nums">{원(미리보기.채운값.기관부담_현금)}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">민간부담 현물</div>
                <div className="tabular-nums">{원(미리보기.채운값.기관부담_현물)}</div>
              </div>
            </div>
            <ul className="flex flex-col gap-0.5">
              {미리보기.근거.map((g, i) => (
                <li key={i} className="text-[11.5px] text-muted-foreground">
                  · {g}
                </li>
              ))}
            </ul>
            {미리보기.주의.map((w, i) => (
              <span key={i} className="text-[11.5px] text-[var(--warning-fg)]">
                {w}
              </span>
            ))}
          </div>
        )}

        {err && <span className="text-[12px] text-destructive">{err}</span>}

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            협약서가 이미 있으면 협약서가 사실입니다 — 들어 있는 재원 금액은 덮어쓰지 않습니다
          </span>
          <Button
            type="button"
            variant="ghost"
            className="ml-auto h-7 text-[12.8px]"
            disabled={pending}
            onClick={onClose}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-7 text-[12.8px]"
            disabled={!낼수있나}
            onClick={계산}
          >
            {pending && !미리보기 ? "계산 중…" : "규정으로 계산"}
          </Button>
          <Button
            type="button"
            className="h-7 text-[12.8px]"
            disabled={!낼수있나 || !미리보기}
            onClick={저장}
          >
            {pending && 미리보기 ? "저장 중…" : "저장하고 계상하러 가기"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
