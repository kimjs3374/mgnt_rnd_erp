"use client"

import * as React from "react"
import {
  getExpenseHistory,
  getExpenseEvidence,
  type HistoryEvent,
  type EvidenceLink,
} from "@/app/actions/expense-history"

/**
 * 집행 한 건의 **처리 이력** — 업로드부터 확정까지.
 *
 * 이 화면의 값어치는 「이 건이 왜 이 비목으로 들어갔나」에 답하는 것이다. 결과만 보여주면
 * 폴더와 다를 게 없다. 그래서 AI 가 뭘 제안했고, 사람이 무엇을 고쳤고, 무슨 사유였는지를
 * 시간순으로 그대로 보여준다.
 *
 * ⚠ 모달을 열 때마다 조회하지 않는다 — 이력 줄을 펼칠 때 한 번만 가져온다.
 *   대부분의 확인은 비목·금액만 보고 닫는다.
 */

const 아이콘: Record<string, string> = {
  upload: "📎", read: "🔍", classify: "🏷", ask: "❓", answer: "💬",
  edit: "✍️", project: "📌", confirm: "✅", correct: "✏️",
  discard: "🗑", store: "📦", relearn: "🔁", comment: "💬",
}

/** 사람이 한 일과 기계가 한 일을 색으로 가른다 — 이력을 볼 때 제일 먼저 찾는 구분이다. */
const 사람행위 = new Set(["edit", "project", "confirm", "correct", "discard", "answer", "comment"])

function 시각(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19).replace("T", " ")
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
}

/** 기계가 읽는 `상세` 중 **사람이 볼 값어치가 있는 것만** 골라 한 줄로. */
function 상세요약(ev: HistoryEvent): string | null {
  const d = ev.상세
  if (!d) return null
  const 조각: string[] = []
  const push = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return
    조각.push(`${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
  }
  if (ev.행위 === "read") {
    push("경로", d.경로)
    push("합계", typeof d.합계 === "number" ? d.합계.toLocaleString("ko-KR") + "원" : null)
    push("일자", d.일자)
  } else if (ev.행위 === "classify") {
    push("출처", d.판단출처)
    if (typeof d.토큰 === "number" && d.토큰 > 0) push("LLM 토큰", d.토큰.toLocaleString("ko-KR"))
  } else if (ev.행위 === "edit") {
    const 이전 = d.이전 as Record<string, unknown> | undefined
    const 새값 = d.새값 as Record<string, unknown> | undefined
    if (이전 && 새값) {
      for (const k of Object.keys(새값)) {
        const a = 이전[k]
        조각.push(`${k}: ${a === null || a === undefined || a === "" ? "(비어 있음)" : String(a)} → ${String(새값[k])}`)
      }
    }
  } else if (ev.행위 === "correct") {
    push("사유", d.사유)
  }
  return 조각.length ? 조각.join(" · ") : null
}

export function ExpenseHistory({ 집행_id }: { 집행_id: number }) {
  const [열림, set열림] = React.useState(false)
  const [rows, setRows] = React.useState<HistoryEvent[] | null>(null)
  const [파일, set파일] = React.useState<EvidenceLink[] | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()

  const 펼치기 = () => {
    const 다음 = !열림
    set열림(다음)
    if (다음 && rows === null) {
      start(async () => {
        try {
          // 이력과 파일을 같이 가져온다 — 이력을 보는 사람은 원본도 같이 확인한다.
          const [h, f] = await Promise.all([
            getExpenseHistory(집행_id),
            getExpenseEvidence(집행_id),
          ])
          setRows(h)
          set파일(f)
        } catch (e) {
          setErr(e instanceof Error ? e.message : "이력을 불러오지 못했다")
        }
      })
    }
  }

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={펼치기}
        aria-expanded={열림}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium hover:bg-muted/50"
      >
        <span>처리 이력{rows ? ` (${rows.length})` : ""}</span>
        <span className="text-muted-foreground">{열림 ? "접기" : "펼치기"}</span>
      </button>

      {열림 && (
        <div className="border-t px-3 py-2">
          {pending && <p className="py-2 text-xs text-muted-foreground">불러오는 중…</p>}
          {err && <p className="py-2 text-xs text-destructive">{err}</p>}

          {파일 && 파일.length > 0 && (
            <div className="mb-2 flex flex-col gap-1 border-b pb-2">
              {파일.map((f) =>
                f.url ? (
                  <a
                    key={f.id}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    <span aria-hidden="true">📎</span>
                    {f.파일명}
                  </a>
                ) : (
                  // 확정 전에는 Storage 에 아무것도 없다 — 확정할 때 올라간다.
                  <span key={f.id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true">📎</span>
                    {f.파일명} <span className="text-[12.1px]">(확정 전 — 아직 보관되지 않음)</span>
                  </span>
                ),
              )}
            </div>
          )}
          {rows && rows.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">
              이력이 없다. 이력 기록을 붙이기 전에 확정된 건이다.
            </p>
          )}
          {rows && rows.length > 0 && (
            <ol className="flex flex-col gap-1.5 py-1">
              {rows.map((ev) => {
                const 상세 = 상세요약(ev)
                const 사람 = 사람행위.has(ev.행위)
                return (
                  <li key={ev.id} className="grid grid-cols-[16px_112px_1fr] items-baseline gap-2 text-xs">
                    <span aria-hidden="true">{아이콘[ev.행위] ?? "·"}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {시각(ev.created_at)}
                    </span>
                    <span className="min-w-0">
                      <span className={사람 ? "font-medium" : ""}>{ev.요약}</span>
                      {ev.행위자 && ev.행위자 !== "system" && (
                        <span className="ml-1.5 text-muted-foreground">· {ev.행위자}</span>
                      )}
                      {상세 && (
                        <span className="mt-0.5 block font-mono text-[12.1px] text-muted-foreground">
                          {상세}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
