"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { confirmEligibility, correctEligibility } from "@/app/actions/eligibility"

/**
 * 자격판정 확인·정정 — 이 회사 계정에서 화면을 잡은 사람이 사람 이름이다.
 * 로그인이 아직 없어 조직 공용이다(app/actions/watchlist.ts·expenses 페이지와 같은 관례) —
 * mgnt3(이 화면 담당)가 확정자로 남는다. 로그인이 붙으면 여기만 고치면 된다.
 */
const ACTOR = "mgnt3"

const 정정사유_유형 = [
  { v: "회사정보변경", label: "회사 정보가 그 사이 바뀌었다" },
  { v: "판독오류", label: "AI가 공고문을 잘못 읽었다" },
  { v: "해석차이", label: "AI와 다르게 해석했다" },
  { v: "직접확인", label: "공고문을 직접 읽고 판단했다" },
] as const

const 판정_선택지 = ["가능", "불가", "확인필요"] as const

function 날짜표시(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * 자격판정 히어로에 붙는 "사람 확인" 위젯 — 관심공고(자격판정=가능)가 AI 제안일 뿐인지,
 * 사람이 실제로 보고 도장을 찍은 것인지를 가른다(사용자 요청, 2026-09-03: "우리가
 * 확인했을 때 정말 가능한 공고는 체크할 수 있게").
 */
export function EligibilityConfirm({
  announcementId,
  확정여부있음,
  정정여부,
  확정자,
  확정일시,
}: {
  announcementId: number
  /** eligibility_decisions 에 행이 하나라도 있는지 — AI 제안조차 없으면 [이대로 확인]을 못 쓴다. */
  확정여부있음: boolean
  정정여부: boolean | null
  확정자: string | null
  확정일시: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [판정, set판정] = React.useState<(typeof 판정_선택지)[number]>("가능")
  const [유형, set유형] = React.useState("")
  const [사유, set사유] = React.useState("")
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  const doConfirm = () =>
    start(async () => {
      const r = await confirmEligibility(announcementId, ACTOR)
      setMsg(r.ok ? { ok: true, text: "확인 처리됐다." } : { ok: false, text: r.error ?? "실패" })
      if (r.ok) router.refresh()
    })

  const doCorrect = () =>
    start(async () => {
      const r = await correctEligibility({ announcementId, 판정, 유형, 사유, 확정자: ACTOR })
      if (r.ok) {
        setMsg({ ok: true, text: "정정 저장됐다." })
        setOpen(false)
        set유형("")
        set사유("")
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? "실패" })
      }
    })

  return (
    <div className="rounded-lg bg-background/60 p-3.5 text-[14.3px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {확정자 ? (
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="size-4" />
              {정정여부 ? `${확정자}님이 정정함` : `${확정자}님이 확인함`}
              {확정일시 && (
                <span className="font-normal opacity-70">· {날짜표시(확정일시)}</span>
              )}
            </div>
          ) : (
            <div className="font-semibold opacity-80">AI 제안만 있음 — 아직 아무도 확인 안 함</div>
          )}
        </div>

        {!open && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={pending || !확정여부있음}
              title={확정여부있음 ? undefined : "AI 제안이 없어 확인할 게 없다 — 직접 판정하세요"}
              onClick={doConfirm}
            >
              이대로 확인
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => setOpen(true)}
            >
              <PenLine className="size-3.5" />
              직접 판정
            </Button>
          </div>
        )}
      </div>

      {msg && (
        <p className={cnMsg(msg.ok)}>{msg.text}</p>
      )}

      {open && (
        <div className="mt-3 grid gap-2.5 rounded-md border bg-card p-3 text-foreground">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">우리 판정</div>
            <div className="flex gap-1.5">
              {판정_선택지.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set판정(p)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-medium " +
                    (판정 === p ? "border-primary bg-primary text-primary-foreground" : "border-input")
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">왜 그렇게 판단했나</div>
            <div className="grid gap-1">
              {정정사유_유형.map((o) => (
                <label key={o.v} className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="자격판정정정유형"
                    value={o.v}
                    checked={유형 === o.v}
                    onChange={() => set유형(o.v)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">한 줄 메모 (필수)</div>
            <input
              type="text"
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              placeholder="예: 공고문 직접 읽어보니 지역 제한이 없어 신청 가능"
              value={사유}
              onChange={(e) => set사유(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            이유를 반드시 남긴다 — 이 판단이 다음에 같은 공고를 볼 때 최우선으로 쓰인다.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || !유형 || !사유.trim()}
              onClick={doCorrect}
            >
              {pending ? "저장 중…" : "정정 저장"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function cnMsg(ok: boolean) {
  return ok
    ? "mt-2 text-xs font-medium text-[var(--success-fg)]"
    : "mt-2 text-xs font-medium text-destructive"
}
