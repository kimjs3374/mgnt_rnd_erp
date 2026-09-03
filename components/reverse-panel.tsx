"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Undo2, Star, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reverseDecision, setInterestFromEngine } from "@/app/actions/engine"
import type { ReversibleRow } from "@/lib/queries-engine"

/**
 * 역방향 — 엔진이 「불가」·「해당없음」으로 접은 것을 사람이 다시 연다.
 *
 * 사용자 요청(2026-09-04): "불가 판정이나 해당없음 판정 받았던 건들 중에 사람이 직접
 * 확인해서 반대로 가능으로 상태변경이나 신청해서 관리할 수 있도록 하는 역방향도 구현해".
 *
 * 왜 이 화면이 필요한가 — 규칙이 세질수록 접히는 건수가 늘고, 접힌 것은 목록에서 안 보인다.
 * 되돌릴 길이 없으면 규칙이 틀렸을 때 신청할 수 있는 공고가 조용히 사라진다(설계원칙 5).
 * **왜 걸렸는지(게이트·근거)를 같은 줄에 펼쳐 두는 이유**도 같다 — 근거를 봐야 되돌릴지
 * 판단할 수 있다.
 *
 * 되돌리면 세 가지가 한 번에 일어난다(app/actions/engine.ts)
 *   ① eligibility_decisions 에 사람 정정으로 남아 **엔진이 다시 못 덮는다**
 *   ② judgment_semantic 에 근거가 쌓여 다음 비슷한 공고에서 참고된다
 *   ③ 원하면 watchlist 「신청예정」으로 올라가 신청 관리로 이어진다
 */

const 확신도색 = (c: number | null) =>
  c == null ? "text-muted-foreground"
    : c >= 0.8 ? "text-destructive"
      : c >= 0.6 ? "text-[var(--warning-fg)]"
        : "text-muted-foreground"

function 남은날(접수종료: string | null, 마감유형: string | null): string {
  if (!접수종료 || (마감유형 ?? "dated") !== "dated") return "상시·수시"
  const d = Math.ceil(
    (new Date(접수종료 + "T00:00:00").getTime() - Date.now()) / 86_400_000,
  )
  return d < 0 ? "마감" : d === 0 ? "오늘 마감" : `D-${d}`
}

export function ReversePanel({ rows }: { rows: ReversibleRow[] }) {
  const router = useRouter()
  const [필터, set필터] = React.useState<"전체" | "불가" | "해당없음">("전체")
  const [열림, set열림] = React.useState<number | null>(null)
  const [사유, set사유] = React.useState("")
  const [판정, set판정] = React.useState<"가능" | "확인필요">("가능")
  const [신청예정, set신청예정] = React.useState(true)
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  const 보이는 = rows.filter((r) => 필터 === "전체" || r.판정 === 필터)

  const 되돌리기 = (id: number) =>
    start(async () => {
      const r = await reverseDecision({
        announcementId: id,
        판정,
        사유,
        관심: 신청예정 ? "신청예정" : null,
      })
      if (r.ok) {
        setMsg({
          ok: true,
          text: `되돌렸다 — 「${판정}」으로 확정했고 엔진이 다시 덮지 않는다.` +
            (신청예정 ? " 신청예정으로도 올렸다." : ""),
        })
        set열림(null)
        set사유("")
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? "실패" })
      }
    })

  const 관심만 = (id: number, 상태: "관심" | "신청예정" | null) =>
    start(async () => {
      const r = await setInterestFromEngine(id, 상태)
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "실패" })
      else router.refresh()
    })

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["전체", "불가", "해당없음"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => set필터(v)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium " +
              (필터 === v ? "border-primary bg-primary text-primary-foreground" : "border-input")
            }
          >
            {v}
            <span className="ml-1.5 opacity-70">
              {v === "전체" ? rows.length : rows.filter((r) => r.판정 === v).length}
            </span>
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          확신도가 낮은 것부터 — 기계가 덜 확신한 것일수록 사람이 볼 값어치가 크다
        </span>
      </div>

      {msg && (
        <p
          className={
            msg.ok
              ? "text-xs font-medium text-[var(--success-fg)]"
              : "text-xs font-medium text-destructive"
          }
        >
          {msg.text}
        </p>
      )}

      {보이는.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          되돌릴 후보가 없다. 마감 전이면서 「불가」·「해당없음」으로 접힌 공고만 여기 모인다.
        </p>
      ) : (
        <ul className="grid gap-2">
          {보이는.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-3 text-[13px]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={
                        "rounded border px-1.5 py-0.5 text-[11px] font-medium " +
                        (r.판정 === "불가"
                          ? "border-destructive/40 text-destructive"
                          : "border-border text-muted-foreground")
                      }
                    >
                      {r.판정}
                    </span>
                    <Link
                      href={`/announcements/${r.id}`}
                      className="truncate font-medium underline-offset-2 hover:underline"
                    >
                      {r.사업명}
                    </Link>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{r.출처}</span>
                    <span>· {남은날(r.접수종료, r.마감유형)}</span>
                    {/* ⚠ 가운뎃점은 본문이지 클래스가 아니다 — 처음에 className 템플릿
                        안에 「·」를 같이 넣어 잘못된 클래스명이 나갔다(2026-09-04 자체 점검). */}
                    <span className={확신도색(r.확신도)}>
                      · 확신도 {r.확신도?.toFixed(2) ?? "-"}
                    </span>
                    <span>· {r.판정경로 ?? "규칙"}</span>
                    {r.관심상태 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                        {r.관심상태}
                      </span>
                    )}
                    {r.사람이정정함 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                        사람이 이미 정정함
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    disabled={pending}
                    onClick={() => 관심만(r.id, r.관심상태 === "관심" ? null : "관심")}
                    title="판정은 그대로 두고 관심만 표시한다"
                  >
                    <Star className="size-3.5" />
                    관심
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      set열림(열림 === r.id ? null : r.id)
                      setMsg(null)
                    }}
                  >
                    <Undo2 className="size-3.5" />
                    되돌리기
                  </Button>
                </div>
              </div>

              {/* 왜 걸렸는지 — 근거를 봐야 되돌릴지 판단할 수 있다 */}
              {(r.걸린게이트.length > 0 || r.근거.length > 0) && (
                <div className="mt-2 rounded-md bg-muted/50 p-2 text-[12px]">
                  {r.걸린게이트.map((g) => (
                    <div key={g.키}>
                      <b>{g.키}</b>
                      <span className="text-muted-foreground"> — {g.설명}</span>
                      {g.사유 && <div className="text-muted-foreground">· {g.사유}</div>}
                    </div>
                  ))}
                  {r.걸린게이트.length === 0 &&
                    r.근거.map((b, i) => (
                      <div key={i} className="text-muted-foreground">
                        {b}
                      </div>
                    ))}
                </div>
              )}

              {열림 === r.id && (
                <div className="mt-2.5 grid gap-2.5 rounded-md border bg-background p-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      어떤 판정으로 되돌리나
                    </div>
                    <div className="flex gap-1.5">
                      {(["가능", "확인필요"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => set판정(v)}
                          className={
                            "rounded-full border px-3 py-1 text-xs font-medium " +
                            (판정 === v
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input")
                          }
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      왜 엔진과 다르게 보는가 (필수)
                    </div>
                    <textarea
                      className="min-h-14 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                      placeholder="예: 지역 제한이 수행지역 표기일 뿐 신청 자격과 무관하다 — 공고문 3쪽 확인"
                      value={사유}
                      onChange={(e) => set사유(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      이 한 줄이 판단 우선순위 1층(정정 이력)에 쌓인다 — 엔진은 앞으로 이 공고를
                      덮지 않고, 뜻이 비슷한 다음 공고에서 참고 사례로 뜬다.
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={신청예정}
                      onChange={(e) => set신청예정(e.target.checked)}
                    />
                    되돌리면서 「신청예정」으로도 올린다
                  </label>

                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => set열림(null)}>
                      취소
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || !사유.trim()}
                      onClick={() => 되돌리기(r.id)}
                    >
                      {pending ? "되돌리는 중…" : `「${판정}」으로 확정`}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
