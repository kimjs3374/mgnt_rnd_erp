"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 계상확정, 계상확정해제 } from "@/app/actions/budget-confirm"
import type { ConfirmRow } from "@/lib/queries-confirm"

/**
 * 계상 확정 막대 — 계상 탭 맨 위.
 *
 * **계상 탭은 계상하는 자리다.** 다 잡고 [계상 확정]을 누르면 그 과제의 관리 위치가
 * 사업 대장으로 넘어가고, 이 탭은 볼 수만 있게 된다(그래서 확정 직후 대장으로 보낸다).
 *
 * 왜 잠그나: 정산 탭의 과제비 원장이 **배정액을 기준으로** 집행과 대조한다.
 * 확정 뒤에도 배정액이 바뀌면 대조 기준이 조용히 달라지고, 그건 정산에서야 드러난다.
 *
 * ⚠ 한도 위반은 확정을 **막지 않는다.** 한도를 넘긴 채 협약된 과제가 실제로 있고
 *   (P01 연구수당 240,000원 초과), 막으면 그 과제는 영영 확정하지 못한다.
 *   넘긴 사실은 아래 계상 표가 이미 빨갛게 말하고 있으므로 여기서는 세어서 보여주기만 한다.
 */

const 원 = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString("ko-KR")

/** ISO → `09-04 01:20` (KST). 서버·클라이언트가 같은 값을 내야 하므로 직접 계산한다. */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

export function BudgetConfirmBar({
  과제_id,
  과제명,
  확정,
  최신,
  이력,
  총사업비,
  배정합,
  위반수,
}: {
  과제_id: number
  과제명: string
  확정: boolean
  최신: ConfirmRow | null
  이력: ConfirmRow[]
  총사업비: number
  배정합: number
  위반수: number
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [err, setErr] = React.useState<string | null>(null)
  const [해제열림, set해제열림] = React.useState(false)
  const [사유, set사유] = React.useState("")
  const [이력열림, set이력열림] = React.useState(false)

  const 차이 = 배정합 - 총사업비
  const 맞음 = 총사업비 > 0 && 배정합 > 0 && 차이 === 0

  function 확정하기() {
    setErr(null)
    start(async () => {
      const r = await 계상확정(과제_id)
      if (!r.ok) {
        setErr(r.error ?? "확정하지 못했습니다.")
        return
      }
      // **관리 위치가 사업 대장으로 넘어간다.** 말로만 하지 않고 실제로 데려다 놓는다.
      router.push("/projects")
    })
  }

  function 해제하기() {
    setErr(null)
    start(async () => {
      const r = await 계상확정해제(과제_id, 사유)
      if (!r.ok) {
        setErr(r.error ?? "해제하지 못했습니다.")
        return
      }
      set해제열림(false)
      set사유("")
      router.refresh()
    })
  }

  if (확정) {
    return (
      <div className="rounded-lg border border-primary bg-primary/5 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[13px] font-medium">계상 확정됨</span>
          <span className="text-[12px] text-muted-foreground">
            {/* 로그인이 아직 없다 — 확인된 행위자만 적는다. 시각은 언제나 사실이다. */}
            {최신 ? 시각(최신.일시) : ""}
            {최신?.행위자_인증 ? ` · ${최신.행위자}` : ""}
          </span>
          <Link
            href="/projects"
            className="ml-auto text-[12.5px] underline underline-offset-2 hover:text-foreground"
          >
            사업 대장에서 보기 →
          </Link>
        </div>

        <p className="mt-1 text-[12.5px] text-muted-foreground">
          이 과제의 관리 위치는 <b className="text-foreground">사업 대장</b>입니다. 계상 탭은 볼 수만
          있습니다 — 정산 탭의 과제비 원장이 아래 배정액을 기준으로 집행과 대조하기 때문에, 확정 뒤에
          숫자가 바뀌면 대조 기준이 조용히 달라집니다.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span className="tabular-nums">
            확정 시점 총사업비 {원(최신?.총사업비_스냅샷)}원 · 계상 {원(최신?.배정합_스냅샷)}원
          </span>
          {/* 확정 이후 총사업비가 바뀌었으면 말한다. 스냅샷을 남긴 이유가 이것이다. */}
          {최신?.총사업비_스냅샷 != null && Number(최신.총사업비_스냅샷) !== 총사업비 && (
            <span className="text-[var(--warning-fg)]">
              지금 총사업비는 {원(총사업비)}원 — 확정할 때와 다릅니다
            </span>
          )}
        </div>

        {해제열림 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              className="h-7 w-96 text-[12.5px]"
              placeholder="왜 다시 여는지 한 줄 (예: 변경협약으로 총사업비가 늘었다)"
              value={사유}
              onChange={(e) => set사유(e.target.value)}
            />
            <Button
              type="button"
              className="h-7 text-[12.8px]"
              disabled={pending || !사유.trim()}
              onClick={해제하기}
            >
              {pending ? "여는 중…" : "해제하고 다시 계상"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-7 text-[12.8px]"
              disabled={pending}
              onClick={() => {
                set해제열림(false)
                set사유("")
                setErr(null)
              }}
            >
              취소
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-7 text-[12.8px]"
              onClick={() => set해제열림(true)}
            >
              확정 해제
            </Button>
            {이력.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                className="h-7 text-[12.8px] text-muted-foreground"
                onClick={() => set이력열림((v) => !v)}
              >
                {이력열림 ? "이력 접기" : `이력 ${이력.length}건`}
              </Button>
            )}
          </div>
        )}

        {이력열림 && <HistoryList 이력={이력} />}
        {err && <p className="mt-2 text-[12px] text-destructive">{err}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">계상 진행 중</span>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          계상 {원(배정합)}원 / 총사업비 {원(총사업비)}원
        </span>
        {총사업비 > 0 && 차이 !== 0 && (
          <span className="text-[12px] text-[var(--warning-fg)] tabular-nums">
            {차이 > 0 ? `${원(차이)}원 많음` : `${원(-차이)}원 남음`}
          </span>
        )}
        {위반수 > 0 && (
          <span className="text-[12px] text-destructive">한도 경고 {위반수}건</span>
        )}
      </div>

      <p className="mt-1 text-[12.5px] text-muted-foreground">
        다 잡았으면 <b className="text-foreground">[계상 확정]</b>을 누르세요. 확정하면 이 탭은 볼
        수만 있게 되고, 관리 위치가 <b className="text-foreground">사업 대장</b>으로 넘어갑니다.
        {위반수 > 0 && " 한도 경고가 있어도 확정할 수 있습니다 — 협약이 그렇게 된 과제가 있어서 막지 않습니다."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="h-7 text-[12.8px]"
          disabled={pending || !맞음}
          onClick={확정하기}
        >
          {pending ? "확정 중…" : "계상 확정"}
        </Button>
        {!맞음 && (
          <span className="text-[12px] text-muted-foreground">
            {총사업비 <= 0
              ? "총사업비가 없습니다 — 과제 계상 화면에서 협약금액을 먼저 확정하세요."
              : 배정합 === 0
                ? "계상한 줄이 없습니다."
                : "계상 합계와 총사업비가 같아야 확정할 수 있습니다."}
          </span>
        )}
        {이력.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto h-7 text-[12.8px] text-muted-foreground"
            onClick={() => set이력열림((v) => !v)}
          >
            {이력열림 ? "이력 접기" : `확정 이력 ${이력.length}건`}
          </Button>
        )}
      </div>

      {이력열림 && <HistoryList 이력={이력} />}
      {err && <p className="mt-2 text-[12px] text-destructive">{err}</p>}
    </div>
  )
}

/**
 * 확정·해제가 언제 누구에 의해 왜 있었는지. 해제 사유를 받는 이유가 여기 남기려는 것이다.
 * ⚠ 컴포넌트 이름은 한글로 짓지 않는다 — JSX 태그 판정이 소문자 ASCII 기준이라 위험하다.
 */
function HistoryList({ 이력 }: { 이력: ConfirmRow[] }) {
  return (
    <ul className="mt-2 space-y-1 border-t pt-2">
      {이력.map((h) => (
        <li key={h.id} className="text-[11.5px] text-muted-foreground">
          <span className="tabular-nums">{시각(h.일시)}</span> · <b>{h.동작}</b>
          {h.행위자_인증 ? ` · ${h.행위자}` : ""}
          {h.사유 ? ` — ${h.사유}` : ""}
        </li>
      ))}
    </ul>
  )
}
