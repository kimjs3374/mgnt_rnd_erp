"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { askChat, type ChatAnswer } from "@/app/actions/chat"
import { MessageSquare, X, CornerDownLeft } from "lucide-react"

/**
 * 어느 화면에서든 열리는 챗 패널.
 * Slack 봇과 **같은 MCP 서버·같은 chat.ask()** 를 쓴다.
 *
 * 추천 질문은 리허설에서 검증한 것으로 고정한다.
 * 시연에서 즉흥 질문을 쓰지 않는 이유는 답이 틀려서가 아니라 **시간이 흔들리기 때문**이다.
 */

const SUGGESTED = [
  "우리가 지금 하는 지원사업 뭐뭐 있지?",
  "아이퍼스 특허 비용 두 건이 왜 다르지?",
  "지금 정산하면 반려당할 게 있나?",
]

type Turn = { q: string; a: ChatAnswer | null }

export function ChatPanel() {
  const [open, setOpen] = React.useState(false)
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [input, setInput] = React.useState("")
  const [pending, start] = React.useTransition()
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns, pending])

  const send = (q: string) => {
    const question = q.trim()
    if (!question || pending) return
    setInput("")
    setTurns((t) => [...t, { q: question, a: null }])
    start(async () => {
      const a = await askChat(question)
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)))
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 h-11 gap-2 rounded-full px-4 shadow-lg"
      >
        <MessageSquare className="size-4" />
        물어보기
      </Button>
    )
  }

  return (
    <aside className="fixed right-0 bottom-0 z-40 flex h-[min(680px,100svh)] w-[min(420px,100vw)] flex-col border-l border-t bg-card">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="text-sm font-semibold">물어보기</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setOpen(false)}
          aria-label="닫기"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-[14.3px]">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              쌓인 것을 근거와 함께 꺼내 줍니다. 도구가 준 것만 답하고, 없으면 없다고 합니다.
            </p>
            <div className="space-y-1.5">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-left hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">
              {t.q}
            </div>

            {t.a === null ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                찾아보는 중… 도구를 부르느라 15초쯤 걸립니다
              </div>
            ) : (
              <div className="space-y-1">
                <div
                  className={
                    t.a.ok
                      ? "whitespace-pre-wrap rounded-lg border bg-background px-3 py-2"
                      : "whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
                  }
                >
                  {t.a.text}
                </div>
                {/* 소요·비용을 숨기지 않는다. 발표 지표로 그대로 쓴다. */}
                <div className="px-1 text-xs text-muted-foreground tabular-nums">
                  {t.a.turns}턴 · {t.a.seconds.toFixed(1)}초
                  {t.a.costUsd != null && ` · $${t.a.costUsd.toFixed(3)}`}
                  {!t.a.ok && " · 도구 연결 확인 필요"}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="무엇이든 물어보세요"
          className="h-8 text-[14.3px]"
          disabled={pending}
        />
        {/* ⚠ shadcn Button 은 기본이 type="button" 이다. 폼에서 submit 을 명시하지 않으면
            에러도 요청도 없이 아무 반응이 없다. */}
        <Button type="submit" className="h-8 shrink-0 px-3" disabled={pending || !input.trim()}>
          <CornerDownLeft className="size-3.5" />
        </Button>
      </form>
    </aside>
  )
}
