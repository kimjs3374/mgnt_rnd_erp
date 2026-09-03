"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Highlighter } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  markImportantPhrase,
  문구_특징키,
  type 문구특징키,
} from "@/app/actions/lexicon"

/**
 * 공고문에서 **사람이 중요한 문구를 짚는다** — 그 문구가 다음 판독부터 규칙이 된다.
 *
 * 사용자 요청(2026-09-04): "공고문에서 필수 체크해야하는 단어들이나 중요하게 판단해야
 * 하는 단어들 공고문에서 사람이 지정해주고 해당내용 학습하도록"
 *
 * JudgmentNote(의미 학습)와 다른 층이다 — 저건 "뜻이 비슷하면" 걸리는 정황이고,
 * 이건 "글자 그대로 있으면" 걸리는 확정이다. 그래서 이건 게이트로 쓰이고 걸리면
 * 「불가」가 확정된다(bot/ann_score.py `_gates()`).
 *
 * ⚠ 짚은 문구는 이 공고에만 적용되는 게 아니다 — **같은 문구가 든 모든 공고**에 걸린다.
 *   그게 이 기능의 값어치이자 위험이라 화면에 그대로 적는다.
 */
export function PhraseMark({ announcementId }: { announcementId: number }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [문구, set문구] = React.useState("")
  const [특징키, set특징키] = React.useState<문구특징키>("특정업종전용")
  const [값, set값] = React.useState("")
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  const 선택된 = 문구_특징키.find((k) => k.v === 특징키)

  const 제출 = () =>
    start(async () => {
      const r = await markImportantPhrase({
        announcementId,
        짚은문구: 문구,
        특징키,
        값,
      })
      if (r.ok) {
        setMsg({
          ok: true,
          text:
            `규칙으로 등록됐다 — 다시 판정하니 「${r.새판정 ?? "?"}」다` +
            (typeof r.확신도 === "number" ? ` (확신도 ${r.확신도.toFixed(2)})` : "") +
            ". 같은 문구가 든 다른 공고도 다음 판독부터 이 규칙으로 걸린다.",
        })
        setOpen(false)
        set문구("")
        set값("")
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? "등록 실패" })
      }
    })

  return (
    <div className="rounded-lg bg-background/60 p-3.5 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold">
          <Highlighter className="size-4" />
          공고문에서 중요한 문구 짚기
        </div>
        {!open && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => setOpen(true)}
          >
            문구 짚기
          </Button>
        )}
      </div>

      {!open && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          규칙이 놓친 조항을 사람이 짚어주면 그게 추출 규칙이 된다 — 다음 판독부터 정규식보다
          먼저 적용되고, 같은 문구가 든 다른 공고도 함께 걸린다.
        </p>
      )}

      {msg && (
        <p
          className={
            msg.ok
              ? "mt-2 text-xs font-medium text-[var(--success-fg)]"
              : "mt-2 text-xs font-medium text-destructive"
          }
        >
          {msg.text}
        </p>
      )}

      {open && (
        <div className="mt-3 grid gap-2.5 rounded-md border bg-card p-3 text-foreground">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              공고문에서 그대로 복사한 문구 (필수)
            </div>
            <textarea
              className="min-h-16 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              placeholder="예: 우리시에서 생산 가공되는 우수한 농특산품을 홍보하고"
              value={문구}
              onChange={(e) => set문구(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              공백은 무시하고 글자 그대로 찾는다. <b>같은 문구가 든 모든 공고에 걸리므로</b>
              , 이 공고에만 있는 표현(「우리시」처럼 지자체마다 뜻이 달라지는 말)보다
              업종·대상을 못박는 표현을 고르는 편이 안전하다.
            </p>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              이 문구가 뜻하는 것
            </div>
            <div className="grid gap-1">
              {문구_특징키.map((k) => (
                <label key={k.v} className="flex items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name="문구특징키"
                    className="mt-0.5"
                    checked={특징키 === k.v}
                    onChange={() => set특징키(k.v)}
                  />
                  <span>
                    {k.label}
                    <span className="block text-[11px] text-muted-foreground">{k.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              값 — 화면에 「〜 전용 공고다」로 적힌다 (필수)
            </div>
            <input
              type="text"
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              placeholder="예: 농특산품 생산·가공업체"
              value={값}
              onChange={(e) => set값(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {선택된?.label} — 이 조건에 걸리면 판정이 「불가」로 확정된다. 저장하면 이 공고를
            즉시 다시 판정해서 결과를 보여준다.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || !문구.trim() || !값.trim()}
              onClick={제출}
            >
              {pending ? "등록하고 다시 판정하는 중…" : "규칙으로 등록"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
