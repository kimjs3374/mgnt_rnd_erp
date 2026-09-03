"use client"

import * as React from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Stat } from "@/components/page-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { 증빙면제, 증빙면제해제 } from "@/app/actions/evidence-waiver"
import type { 증빙구멍 } from "@/lib/evidence-gap-types"

/**
 * 「사업비 증빙 미비」 카드 — **눌러서 목록을 보고 그 자리로 간다.** (2026-09-04 사용자 지시)
 *
 * 숫자만 있으면 「3건」을 보고도 무엇을 해야 할지 모른다. 그래서 누르면
 * **어느 과제의 어느 집행에 무슨 서류가 없는지**를 한 줄씩 보여주고,
 * 각 줄에서 그 집행 건의 증빙 칸으로 바로 보낸다(`?expense=<id>` — 집행 표가 그 건을 펼친 채로 연다).
 *
 * 오래된 집행부터 세운다 — 정산 마감이 먼저 닿는 쪽이다(조회 계층이 그 순서로 준다).
 */

const won = (n: number | null | undefined) =>
  n == null ? "—" : `₩${Math.round(Number(n)).toLocaleString("ko-KR")}`

export type 과제구멍 = { id: number; 과제명: string; 구멍: 증빙구멍 }

/**
 * 과제 블록을 갈라 보이게 하는 **구분용** 색. (2026-09-04 사용자 지시)
 *
 * ⚠ **뜻이 없는 색이다.** 이 앱에서 색은 대개 뜻을 지고 있다 —
 *   연빨강=종료 · 호박(warning)=손봐야 함 · 초록=여유 · 차트 팔레트=비목.
 *   여기 색은 「몇 번째 과제인가」만 말한다. 그래서 **경고·상태 계열을 피해서** 골랐고
 *   순서대로 돌려 쓴다. 과제가 다섯을 넘으면 처음 색으로 돌아온다 — 붙어 있는 두 블록만
 *   서로 다르면 되기 때문이다.
 *
 * 색만으로 가르지 않는다 — **왼쪽 굵은 띠 + 머리 배경 + 순번**을 같이 준다.
 * 색을 못 보는 사람에게도 갈라져 보여야 한다.
 */
const 구분색 = [
  "border-l-sky-400 dark:border-l-sky-600",
  "border-l-violet-400 dark:border-l-violet-600",
  "border-l-teal-400 dark:border-l-teal-600",
  "border-l-slate-400 dark:border-l-slate-500",
  "border-l-fuchsia-400 dark:border-l-fuchsia-600",
]

export function EvidenceGapCard({
  과제들,
  비목이름 = {},
}: {
  과제들: 과제구멍[]
  /** 비목 코드 → 한글. 화면에 EQUIP_PURCHASE 가 보이면 안 된다. */
  비목이름?: Record<string, string>
}) {
  const [열림, set열림] = React.useState(false)
  // 지금 사유를 적는 칸 하나. 「어느 집행의 어느 서류를, 면제인지 해제인지」.
  const [면제중, set면제중] = React.useState<{
    집행_id: number
    요건_id: number
    서류명: string
    동작: "면제" | "해제"
  } | null>(null)
  const [사유, set사유] = React.useState("")
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()

  function 보내기() {
    if (!면제중) return
    if (!사유.trim()) {
      setMsg({ ok: false, text: "사유를 적어야 저장됩니다 — 정산에서 그대로 근거가 됩니다." })
      return
    }
    const 대상 = 면제중
    start(async () => {
      const r =
        대상.동작 === "면제"
          ? await 증빙면제({ 집행_id: 대상.집행_id, 요건_id: 대상.요건_id, 사유 })
          : await 증빙면제해제({ 집행_id: 대상.집행_id, 요건_id: 대상.요건_id, 사유 })
      setMsg(
        r.ok
          ? {
              ok: true,
              text: `${대상.서류명}을(를) ${대상.동작 === "면제" ? "정상 처리했습니다" : "다시 미비로 돌렸습니다"} — 사유와 처리자가 기록에 남았습니다.`,
            }
          : { ok: false, text: r.error ?? "처리하지 못했습니다." },
      )
      if (r.ok) {
        set면제중(null)
        set사유("")
      }
    })
  }
  const 빈집행건 = 과제들.reduce((s, p) => s + p.구멍.빈집행건, 0)
  const 빈칸 = 과제들.reduce((s, p) => s + p.구멍.빈칸, 0)
  const 있다 = 과제들.length > 0

  const 카드 = (
    <Stat
      icon={TriangleAlert}
      label="사업비 증빙 미비"
      value={과제들.length}
      sub={
        있다
          ? `과제 ${과제들.length}건 · 증빙 없는 집행 ${빈집행건}건 — 눌러서 보기`
          : "집행 건별 필수 서류가 다 채워져 있다"
      }
      tone={있다 ? "warn" : "default"}
    />
  )

  // 구멍이 없으면 누를 것도 없다. 눌러도 빈 목록이 뜨는 버튼을 만들지 않는다.
  if (!있다) return 카드

  return (
    <>
      <button
        type="button"
        className="cursor-pointer text-left transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => set열림(true)}
        aria-label={`사업비 증빙 미비 ${과제들.length}건 — 목록 보기`}
      >
        {카드}
      </button>

      <Dialog open={열림} onOpenChange={set열림}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              사업비 증빙 미비 — 과제 {과제들.length}건 · 증빙 없는 집행 {빈집행건}건
            </DialogTitle>
            <DialogDescription>
              집행 건에 붙어야 하는 <b>필수 서류</b>가 빈 곳입니다. 정산에서 반려되는 자리라
              오래된 집행부터 세웠습니다. 줄을 누르면 그 집행 건의 증빙 칸으로 바로 갑니다.
            </DialogDescription>
          </DialogHeader>

          {msg && (
            <p className={`text-[12.5px] ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}>
              {msg.text}
            </p>
          )}

          <div className="space-y-4">
            {과제들.map((p, i) => (
              <div
                key={p.id}
                className={`overflow-hidden rounded-lg border border-l-4 ${구분색[i % 구분색.length]}`}
              >
                <div className="flex flex-wrap items-baseline gap-2 border-b bg-secondary/60 p-2.5">
                  {/* 순번 — 색을 못 봐도 「몇 번째 과제」인지는 읽힌다. */}
                  <span className="rounded bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {i + 1}/{과제들.length}
                  </span>
                  <Link
                    href={`/projects/${p.id}/expenses`}
                    className="text-[13px] font-semibold underline-offset-2 hover:underline"
                  >
                    {p.과제명}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    집행 {p.구멍.집행건}건 중 {p.구멍.빈집행건}건에 증빙 없음
                    {p.구멍.면제칸 > 0 ? ` · 면제 ${p.구멍.면제칸}칸` : ""}
                  </span>
                </div>
                {/* 열 이름 — 「0/4」 같은 숫자는 머리말이 없으면 무슨 수인지 모른다.
                    이 화면이 고쳐 온 문제가 정확히 그거다(단위 없는 숫자). */}
                <div className="flex items-baseline gap-x-3 border-b px-2.5 py-1 text-[11px] text-muted-foreground">
                  <span className="w-[82px] shrink-0">일자</span>
                  <span className="min-w-0 flex-1">거래처</span>
                  <span className="w-[104px] shrink-0 text-right">금액</span>
                  <span className="w-[74px] shrink-0">비목</span>
                  <span className="w-[46px] shrink-0 text-right">확보</span>
                  <span className="w-[96px] shrink-0" aria-hidden />
                </div>
                <ul className="divide-y">
                  {p.구멍.상세.map((e) => (
                    <li key={e.집행_id} className="flex flex-col gap-1 p-2.5">
                      {/* ⚠ 열 폭을 고정한다. flex-wrap 으로 두면 거래처 이름 길이에 따라
                          금액이 행마다 밀려서 **세로로 훑을 수가 없다**(사용자 선택: 열 맞춤). */}
                      <div className="flex items-baseline gap-x-3">
                        <span className="w-[82px] shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                          {e.일자 ?? "일자 미상"}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[13px] font-medium"
                          title={e.거래처 ?? ""}
                        >
                          {e.거래처 ?? "거래처 미상"}
                        </span>
                        {/* 금액이 판단의 기준이다 — 우측 정렬 + 굵게. 회색 작은 글씨로 두면 안 읽힌다. */}
                        <span className="w-[104px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums">
                          {won(e.합계)}
                        </span>
                        <span className="w-[74px] shrink-0 truncate text-[12px] text-muted-foreground">
                          {e.비목_대분류 ? (비목이름[e.비목_대분류] ?? e.비목_대분류) : "—"}
                        </span>
                        <span
                          className={`w-[46px] shrink-0 text-right text-[12px] tabular-nums ${
                            e.확보종 === e.필수종 ? "text-muted-foreground" : "text-[var(--warning-fg)]"
                          }`}
                          title={`필수 ${e.필수종}종 중 ${e.확보종}종 확보`}
                        >
                          {e.확보종}/{e.필수종}
                        </span>
                        <Link
                          href={`/projects/${p.id}/expenses?expense=${e.집행_id}`}
                          className="w-[96px] shrink-0 rounded-md border px-2 py-0.5 text-center text-[12px] hover:bg-secondary"
                          onClick={() => set열림(false)}
                        >
                          채우러 가기 →
                        </Link>
                      </div>
                      {/* 무슨 서류가 없는지까지 적는다 — 「증빙 부족」만으로는 무엇을 준비할지 모른다.
                          서류마다 [면제]가 붙는다 — 거래 성격상 그 서류가 없는 건을 영원히
                          빨간 숫자로 두면 그 카드를 아무도 안 본다(사용자 지시). 사유는 필수다. */}
                      {e.빠진서류.length > 0 && (
                        <span className="flex w-full flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--warning-fg)]">
                          증빙 필수 서류:
                          {e.빠진서류.map((이름, k) => (
                            <span
                              key={`${e.집행_id}-${이름}`}
                              className="inline-flex items-center gap-1 rounded border border-[var(--warning-fg)]/30 bg-[var(--warning)] px-1.5 py-0.5"
                            >
                              {이름}
                              <button
                                type="button"
                                className="text-[11px] underline underline-offset-2 hover:no-underline"
                                title="이 서류 없이도 정상으로 본다 — 사유를 적어야 저장된다"
                                onClick={() => {
                                  setMsg(null)
                                  set사유("")
                                  set면제중({
                                    집행_id: e.집행_id,
                                    요건_id: e.빠진요건ids[k],
                                    서류명: 이름,
                                    동작: "면제",
                                  })
                                }}
                              >
                                면제
                              </button>
                            </span>
                          ))}
                        </span>
                      )}

                      {/* 면제한 칸 — 지우지 않고 남긴다. 커서를 올리면 사유·처리자·일시가 보인다. */}
                      {e.면제.length > 0 && (
                        <span className="flex w-full flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                          면제:
                          {e.면제.map((w) => (
                            <span
                              key={`${e.집행_id}-w-${w.요건_id}`}
                              className="inline-flex items-center gap-1 rounded border bg-secondary/60 px-1.5 py-0.5"
                              title={`${w.사유} — ${w.행위자} · ${w.일시.slice(0, 16).replace("T", " ")}`}
                            >
                              {w.서류명}
                              <button
                                type="button"
                                className="text-[11px] underline underline-offset-2 hover:no-underline"
                                title="면제를 되돌린다 — 이유를 적어야 저장된다"
                                onClick={() => {
                                  setMsg(null)
                                  set사유("")
                                  set면제중({
                                    집행_id: e.집행_id,
                                    요건_id: w.요건_id,
                                    서류명: w.서류명,
                                    동작: "해제",
                                  })
                                }}
                              >
                                해제
                              </button>
                            </span>
                          ))}
                        </span>
                      )}

                      {/* 사유 칸 — 그 줄 바로 아래에서 적는다. 다른 화면으로 보내지 않는다. */}
                      {면제중?.집행_id === e.집행_id && (
                        <span className="mt-1 flex w-full flex-wrap items-center gap-1.5">
                          <span className="text-[12px] font-medium">
                            {면제중.서류명} {면제중.동작 === "면제" ? "면제" : "해제"} 사유
                          </span>
                          <Input
                            autoFocus
                            value={사유}
                            onChange={(ev) => set사유(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") 보내기()
                              if (ev.key === "Escape") set면제중(null)
                            }}
                            placeholder={
                              면제중.동작 === "면제"
                                ? "예: 수의계약이라 견적의뢰서가 없음 / 무상 제공이라 세금계산서 없음"
                                : "예: 사업주체가 서류를 요구한다고 회신"
                            }
                            className="h-7 min-w-[280px] flex-1 text-[12.5px]"
                            aria-label="면제 사유"
                          />
                          <Button
                            type="button"
                            className="h-7 text-[12px]"
                            disabled={pending || !사유.trim()}
                            onClick={보내기}
                          >
                            {pending ? "저장 중…" : "저장"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 text-[12px]"
                            onClick={() => set면제중(null)}
                          >
                            취소
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            비목별로 요구 서류가 다릅니다(`app.evidence_requirements`). 인건비·간접비처럼 집행 건별
            증빙을 요구하지 않는 비목은 여기 세지 않습니다 — 없는 요건을 「비었다」고 하면 그게 거짓말입니다.
            <br />
            <b>면제</b>는 증빙 파일을 만들어 주는 것이 아닙니다 — 「이 칸은 이 사유로 비워 둔다」는
            판단을 남기는 것입니다. 미비 숫자에서는 빠지지만 <b>사유·처리자·일시가 기록에 남고</b>{" "}
            면제 칸 수도 위에 그대로 보입니다. 정산 실사에서 그 사유를 그대로 제시하게 됩니다.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
