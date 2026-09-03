"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { syncAnnouncements } from "@/app/actions/announcements"

/**
 * 지원사업 목록 동기화 — 기업마당 + K-Startup 공식 오픈API.
 *
 * components/announcements-explorer.tsx 안의 SyncButton 을 쓰지 않고 따로 둔 이유:
 * 그건 기업마당 하나만 부르고 「N건 확인」이라고 말한다. 지금은 출처가 둘이라
 * **어느 쪽이 몇 건이고 어느 쪽이 실패했는지**를 그대로 보여줘야 한다.
 * 공공 API 는 한쪽이 5xx 를 내는 일이 잦은데, 합쳐서 한 숫자로 말하면
 * 절반만 갱신된 것을 성공으로 착각한다.
 *
 * 첨부파일 판독은 여기서 하지 않는다 — 건당 수 초~수십 초라 버튼 클릭에 안 맞는다.
 * 그건 서버의 `node scripts/collect-bizinfo.mjs` 가 따로 한다.
 */
export function SyncAnnouncementsButton() {
  const [state, setState] = React.useState<"idle" | "loading" | "done" | "error">("idle")
  const [message, setMessage] = React.useState<string | null>(null)

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-7 text-[12.8px]"
        disabled={state === "loading"}
        title="기업마당·K-Startup 오픈API에서 목록을 다시 받는다. 첨부 서류판독은 서버 배치가 처리한다."
        onClick={async () => {
          setState("loading")
          setMessage(null)
          const r = await syncAnnouncements()
          setState(r.ok ? "done" : "error")
          setMessage(
            r.출처별
              ?.map((s) => (s.오류 ? `${s.출처} 실패` : `${s.출처} ${s.건수}건`))
              .join(" · ") ??
              r.error ??
              "동기화 실패",
          )
        }}
      >
        {state === "loading" ? "동기화 중…" : "↻ 동기화"}
      </Button>
      {message && (
        <span
          className={
            state === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {message}
        </span>
      )}
    </div>
  )
}
