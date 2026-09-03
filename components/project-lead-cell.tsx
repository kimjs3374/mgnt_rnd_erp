"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { setProjectLead } from "@/app/actions/project-lead"

/**
 * 대장 한 줄의 연구책임자 칸. 눌러서 바로 고친다.
 *
 * 왜 별도 화면이 아니라 칸 안에서 고치는가: 책임자 확인은 **대장을 훑다가** 하는 일이다.
 * 과제 상세로 들어갔다 나오면 보던 자리를 잃는다.
 *
 * 권한은 여기서 보지 않는다 — 서버 액션(`app/actions/project-lead.ts`)의 `수정권한()` 한 곳이
 * 판정자다. 화면에서 버튼을 감추는 것은 **안내이지 방어가 아니다.**
 */
export function ProjectLeadCell({
  과제_id,
  표시명,
  로그인,
}: {
  과제_id: number
  표시명: string | null
  /** 세션으로 확인된 사람인가. 안내 문구를 가르는 데만 쓴다(막지 않는다). */
  로그인?: boolean
}) {
  const [값, set값] = React.useState(표시명 ?? "")
  const [고침, set고침] = React.useState(false)
  const [초안, set초안] = React.useState(표시명 ?? "")
  const [오류, set오류] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()

  // 서버가 새로 그려 주면 화면 값을 따라 맞춘다(다른 사람이 바꿨을 수 있다).
  React.useEffect(() => {
    set값(표시명 ?? "")
  }, [표시명])

  function 저장() {
    const v = 초안.trim()
    if (v === 값) {
      set고침(false)
      set오류(null)
      return
    }
    set오류(null)
    start(async () => {
      const r = await setProjectLead({ 과제_id, 표시명: v })
      if (r.ok) {
        set값(r.표시명 ?? v)
        set고침(false)
      } else {
        set오류(r.error ?? "바꾸지 못했습니다.")
      }
    })
  }

  if (!고침) {
    return (
      <button
        type="button"
        onClick={() => {
          set초안(값)
          set고침(true)
          set오류(null)
        }}
        className="group inline-flex items-center gap-1 text-left underline-offset-2 hover:underline"
        title="눌러서 연구책임자를 바꿉니다"
      >
        <span className={값 ? "" : "text-muted-foreground"}>{값 || "미지정"}</span>
        <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          ✎
        </span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={초안}
          disabled={pending}
          onChange={(e) => set초안(e.target.value)}
          onKeyDown={(e) => {
            // 표 안이라 Enter 로 저장하고 Esc 로 되돌린다. 마우스를 다시 잡게 하지 않는다.
            if (e.key === "Enter") 저장()
            if (e.key === "Escape") {
              set고침(false)
              set오류(null)
            }
          }}
          className="h-7 w-28 text-[12.5px]"
          aria-label="연구책임자"
        />
        {/* shadcn Button 기본이 type="button" 이라 폼 안에서도 제출되지 않는다(CLAUDE.md §7). */}
        <Button type="button" className="h-7 px-2 text-[11.5px]" disabled={pending} onClick={저장}>
          {pending ? "…" : "저장"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-1.5 text-[11.5px] text-muted-foreground"
          disabled={pending}
          onClick={() => {
            set고침(false)
            set오류(null)
          }}
        >
          취소
        </Button>
      </div>
      {오류 ? (
        <span className="text-[11px] text-destructive">{오류}</span>
      ) : (
        // 절대규칙 5 — 배포 URL 은 열려 있다. 서버가 실명을 걸러낼 수는 없으니 여기서 말한다.
        <span className="text-[11px] text-muted-foreground">
          공개 주소에는 가명을 쓰세요
        </span>
      )}
    </div>
  )
}
