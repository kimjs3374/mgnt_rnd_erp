"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CalendarClock } from "lucide-react"
import { Stat } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  saveSettlementRule,
  saveSettlementOverride,
  deleteSettlementOverride,
} from "@/app/actions/settlement"

/**
 * 이번 정산 마감 카드 — **사람이 바로 고친다.** (2026-09-04 사용자 지시)
 *
 * 「회계 일정은 매번 달라진다」고 해서 두 가지를 다 열어 뒀다:
 *   · **기본 규칙** — 매월 N일, 쉬는 날이면 앞으로 당길지 뒤로 미룰지
 *   · **이번 달만** — 규칙으로 못 담는 달은 날짜를 직접 잡는다(규칙보다 이게 이긴다)
 *
 * 설정 화면을 따로 만들지 않았다. 마감을 확인하는 자리가 곧 고치는 자리다 —
 * 설정을 다른 화면에 두면 「어디서 고치지」를 매번 찾게 된다.
 */
export type 정산표시 = {
  날: string
  원래: string
  옮겨짐: boolean
  이유: "주말" | "공휴일" | null
  달지정: boolean
  달지정사유: string | null
  요일: string
  남은일: number
  확인필요: boolean
  규칙: { 기준일: number; 이동: "앞" | "뒤" | "그대로" }
  기본값사용: boolean
}

const 이동설명: Record<string, string> = {
  앞: "앞 영업일로 당김",
  뒤: "다음 영업일로 미룸",
  그대로: "그대로 둠",
}

export function SettlementDeadlineCard({ 정산 }: { 정산: 정산표시 }) {
  const router = useRouter()
  const [열림, set열림] = React.useState(false)
  const [기준일, set기준일] = React.useState(String(정산.규칙.기준일))
  const [이동, set이동] = React.useState<string>(정산.규칙.이동)
  const [이번달, set이번달] = React.useState(정산.달지정 ? 정산.날 : "")
  const [사유, set사유] = React.useState(정산.달지정사유 ?? "")
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()

  const 연월 = 정산.날.slice(0, 7)

  function 규칙저장() {
    setMsg(null)
    start(async () => {
      const r = await saveSettlementRule({ 기준일, 이동 })
      setMsg(r.ok ? { ok: true, text: "규칙을 바꿨습니다." } : { ok: false, text: r.error ?? "" })
      if (r.ok) router.refresh()
    })
  }

  function 이번달저장() {
    setMsg(null)
    start(async () => {
      const r = 이번달
        ? await saveSettlementOverride({ 연월, 마감일: 이번달, 사유 })
        : await deleteSettlementOverride(연월)
      setMsg(
        r.ok
          ? { ok: true, text: 이번달 ? `${연월} 마감을 ${이번달} 로 잡았습니다.` : "규칙대로 되돌렸습니다." }
          : { ok: false, text: r.error ?? "" },
      )
      if (r.ok) router.refresh()
    })
  }

  const 설명 =
    (정산.달지정
      ? `${정산.날}(${정산.요일}) · 이번 달만 따로 잡음`
      : `${정산.날}(${정산.요일}) · 매월 ${정산.규칙.기준일}일`) +
    (정산.옮겨짐 ? ` — ${정산.규칙.기준일}일이 ${정산.이유}이라 ${이동설명[정산.규칙.이동]}` : "") +
    (정산.확인필요 ? " · 음력 공휴일 확인 필요" : "") +
    (정산.기본값사용 ? " · 설정을 못 읽어 기본값" : "")

  const cell = "h-7 text-[12.5px]"

  return (
    <div className="relative">
      <Stat
        icon={CalendarClock}
        label="이번 정산 마감"
        value={정산.남은일 === 0 ? "오늘" : `D-${정산.남은일}`}
        sub={설명}
        tone={정산.남은일 <= 7 ? "warn" : "default"}
      />
      {/* 확인하는 자리가 곧 고치는 자리다. 설정 화면을 따로 두지 않는다. */}
      <button
        type="button"
        onClick={() => {
          set열림((v) => !v)
          setMsg(null)
        }}
        className="absolute top-2 right-2 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:bg-secondary/60 hover:underline"
      >
        {열림 ? "닫기" : "고치기"}
      </button>

      {열림 && (
        <div className="absolute top-full right-0 z-20 mt-1 w-[330px] rounded-lg border bg-card p-3 shadow-lg">
          <div className="mb-2 text-[12.5px] font-medium">정산 마감 규칙</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11.5px] text-muted-foreground">
              매월
              <Input
                type="number"
                min={1}
                max={31}
                className={`${cell} w-16`}
                value={기준일}
                onChange={(e) => set기준일(e.target.value)}
                aria-label="정산 기준일"
              />
            </label>
            <span className="pb-1.5 text-[11.5px] text-muted-foreground">일</span>
            <label className="text-[11.5px] text-muted-foreground">
              주말·공휴일이면
              <select
                className="h-7 w-full rounded-md border bg-transparent px-2 text-[12.5px] text-foreground"
                value={이동}
                onChange={(e) => set이동(e.target.value)}
                aria-label="쉬는 날 처리"
              >
                <option value="앞">앞 영업일로 당김</option>
                <option value="뒤">다음 영업일로 미룸</option>
                <option value="그대로">그대로 둠</option>
              </select>
            </label>
            <Button
              type="button"
              className="ml-auto h-7 text-[12.5px]"
              disabled={pending}
              onClick={규칙저장}
            >
              저장
            </Button>
          </div>

          <div className="mt-3 border-t pt-2">
            <div className="mb-1 text-[12.5px] font-medium">{연월} 만 따로</div>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              규칙으로 안 맞는 달은 날짜를 직접 잡습니다. <b>규칙보다 이게 이깁니다.</b>
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="date"
                className={`${cell} w-[135px]`}
                value={이번달}
                onChange={(e) => set이번달(e.target.value)}
                aria-label="이번 달 마감일"
              />
              <Input
                className={`${cell} w-[110px]`}
                placeholder="사유(선택)"
                value={사유}
                onChange={(e) => set사유(e.target.value)}
                aria-label="이번 달 마감 사유"
              />
              <Button
                type="button"
                variant="outline"
                className="ml-auto h-7 text-[12.5px]"
                disabled={pending}
                onClick={이번달저장}
              >
                {이번달 ? "이 달만 적용" : "규칙대로"}
              </Button>
            </div>
          </div>

          {정산.확인필요 && (
            <p className="mt-2 rounded bg-[var(--warning)] px-2 py-1 text-[11px] text-[var(--warning-fg)]">
              음력 공휴일(설·부처님오신날·추석)이 판단에 끼었습니다. 달력을 보고
              <b> app.holidays </b>를 확인하세요 — 틀리면 D-day 가 며칠씩 어긋납니다.
            </p>
          )}
          {msg && (
            <p className={`mt-2 text-[11.5px] ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
