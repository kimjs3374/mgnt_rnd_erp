"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFileDrop, 드롭강조 } from "@/components/use-file-drop"
import { 문서파일_점검 } from "@/lib/upload-limits"
import {
  uploadSettlementDocuments,
  getSettlementDownloadUrl,
  deleteSettlementDocument,
} from "@/app/actions/settlement-files"
import { 정산서류_기본 } from "@/lib/settlement-types"
import type { SettlementDocument } from "@/lib/settlement-types"

/**
 * 과제 **최종 정산 서류** — 협약기간이 끝난 과제만 받는다. (2026-09-04 사용자 지시)
 *
 * 정산은 과제의 마지막 단계라 이 카드가 정산 탭 맨 아래에 있다 —
 * 원장 → 사용 건 → RCMS 대조 → **최종 정산 제출**이 일하는 순서다.
 *
 * **놓는 자리가 곧 서류종류다**(증빙 첨부·업체 서류와 같은 규칙).
 * 파일명으로 종류를 짐작해 자동 분류하지 않는다 — 잘못 붙으면 「무엇을 냈는지」가 거짓이 된다.
 *
 * 기간이 남은 과제에는 **왜 아직 못 올리는지**를 적는다. 칸을 숨기면 「기능이 없다」로 읽힌다.
 */

const KB = (n: number | null) =>
  n == null
    ? ""
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))}KB`
      : `${(n / 1024 / 1024).toFixed(1)}MB`

/** ISO → `09-04 03:20` (KST). 서버·클라이언트가 같은 값을 내야 하므로 직접 계산한다. */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/** 서류 한 자리. 부모 밖에 둔다 — 렌더마다 타입이 새로 생기면 드래그 도중 드롭이 씹힌다. */
function DocSlot({
  종류,
  목록,
  켜짐,
  드롭영역props,
  막힘,
  pending,
  onFiles,
  on내려받기,
  on지우기,
}: {
  종류: string
  목록: SettlementDocument[]
  켜짐: boolean
  드롭영역props: React.ComponentProps<"div">
  /** 기간이 안 끝나 못 받는 상태면 그 이유. 커서도 「금지」로 바뀐다. */
  막힘: string | null
  pending: boolean
  onFiles: (files: File[]) => void
  on내려받기: (id: number) => void
  on지우기: (id: number, 파일명: string) => void
}) {
  const 입력 = React.useRef<HTMLInputElement>(null)
  return (
    <div
      {...드롭영역props}
      className={`rounded-lg border p-3 transition-colors ${
        켜짐 ? (막힘 ? 드롭강조.막힘 : 드롭강조.카드) : ""
      } ${막힘 ? "cursor-not-allowed" : ""}`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">{종류}</span>
        {목록.length === 0 ? (
          <span className="text-xs text-muted-foreground">미제출</span>
        ) : (
          <span className="text-xs text-muted-foreground">{목록.length}건</span>
        )}
        {!막힘 && (
          <>
            <Button
              type="button"
              variant="outline"
              className="ml-auto h-6 text-[12px]"
              disabled={pending}
              onClick={() => 입력.current?.click()}
            >
              파일 첨부
            </Button>
            <input
              ref={입력}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onFiles(Array.from(e.target.files ?? []))
                e.target.value = ""
              }}
            />
          </>
        )}
      </div>

      {목록.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {막힘 ?? `여기에 파일을 끌어다 놓으면 ${종류} 으로 분류됩니다.`}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {목록.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                disabled={pending}
                onClick={() => on내려받기(d.id)}
              >
                {d.파일명}
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {KB(d.크기)} · {시각(d.업로드일시)}
                {d.제출일 ? ` · 제출 ${d.제출일}` : ""}
                {d.정산연차 ? ` · ${d.정산연차}차년도` : ""}
                {d.업로더_인증 ? ` · ${d.업로더}` : ""}
              </span>
              {d.비고 && <span className="text-xs text-muted-foreground">{d.비고}</span>}
              <button
                type="button"
                className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                disabled={pending}
                onClick={() => on지우기(d.id, d.파일명)}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SettlementDocuments({
  과제_id,
  파일,
  기간끝남,
  종료일,
  협약연수,
}: {
  과제_id: number
  파일: SettlementDocument[]
  /** 협약기간이 끝났는가. 서버가 판정해 내려준다 — 화면에서 날짜를 다시 계산하지 않는다. */
  기간끝남: boolean
  종료일: string | null
  /** 연차별로 정산하는 사업이면 연차를 고를 수 있게 한다. 1이면 칸을 만들지 않는다. */
  협약연수: number
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()
  const [제출일, set제출일] = React.useState("")
  const [정산연차, set정산연차] = React.useState("")
  const 막힘 = 기간끝남
    ? null
    : `협약기간이 아직 끝나지 않았습니다(종료 ${종료일 ?? "미정"}). 최종 정산 서류는 기간이 끝난 뒤에 올립니다.`
  const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })

  function 올리기(서류종류: string, files: File[]) {
    if (막힘) {
      setMsg({ ok: false, text: 막힘 })
      return
    }
    const 고른것 = files.filter(Boolean)
    if (!고른것.length) return
    if (pending) {
      setMsg({ ok: false, text: "앞의 파일을 올리는 중입니다. 끝난 뒤에 놓으세요." })
      return
    }

    // 서버가 최종 판정자지만 여기서 먼저 거른다 — 25MB 를 끝까지 올려보낸 뒤 거절하면
    // 그 시간이 그냥 날아간다. 규칙은 `lib/upload-limits.ts` 한 벌을 같이 본다.
    const 거절: string[] = []
    const 보낼것: File[] = []
    for (const f of 고른것) {
      const 문제 = 문서파일_점검(f)
      if (문제) 거절.push(문제)
      else 보낼것.push(f)
    }
    if (!보낼것.length) {
      setMsg({ ok: false, text: 거절.join(" / ") })
      return
    }

    const fd = new FormData()
    fd.set("과제_id", String(과제_id))
    fd.set("서류종류", 서류종류)
    if (제출일) fd.set("제출일", 제출일)
    if (정산연차) fd.set("정산연차", 정산연차)
    for (const f of 보낼것) fd.append("files", f)

    setMsg(null)
    start(async () => {
      const r = await uploadSettlementDocuments(fd)
      const 앞 = 거절.length ? `${거절.join(" / ")} ` : ""
      setMsg({
        ok: r.ok,
        text: r.error ? `${앞}${r.error}` : `${앞}${서류종류} ${r.올린수 ?? 0}건 올렸습니다.`,
      })
    })
  }

  function 내려받기(id: number) {
    start(async () => {
      const r = await getSettlementDownloadUrl(id)
      if (!r.ok || !r.url) {
        setMsg({ ok: false, text: r.error ?? "내려받지 못했습니다." })
        return
      }
      window.location.href = r.url
    })
  }

  function 지우기(id: number, 파일명: string) {
    start(async () => {
      const r = await deleteSettlementDocument(id)
      setMsg({
        ok: r.ok,
        text: r.ok ? `${파일명} 을 지웠습니다.` : (r.error ?? "지우지 못했습니다."),
      })
    })
  }

  const 자리props = (종류: string) => ({
    종류,
    목록: 파일.filter((d) => d.서류종류 === 종류),
    켜짐: 드롭대상 === `settle:${종류}`,
    드롭영역props: 드롭영역(`settle:${종류}`, (files) => 올리기(종류, files), 막힘),
    막힘,
    pending,
    onFiles: (files: File[]) => 올리기(종류, files),
    on내려받기: 내려받기,
    on지우기: 지우기,
  })

  const 기타 = 파일.filter(
    (d) => !(정산서류_기본 as readonly string[]).includes(d.서류종류),
  )

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
        <span className="text-[13px] font-medium">최종 정산 서류</span>
        <span className="text-xs text-muted-foreground">
          {기간끝남
            ? `협약기간이 끝났습니다(종료 ${종료일 ?? "미정"}) — 제출한 서류를 여기 보관합니다`
            : 막힘}
        </span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {파일.length}건 보관
        </span>
      </div>

      <div className="space-y-2 p-3">
        {msg && (
          <p className={`text-[12.5px] ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}>
            {msg.text}
          </p>
        )}

        {기간끝남 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">
              제출일
              <Input
                type="date"
                value={제출일}
                onChange={(e) => set제출일(e.target.value)}
                className="mt-1 h-7 w-[150px] text-[13px]"
                aria-label="정산 제출일"
              />
            </label>
            {협약연수 > 1 && (
              <label className="text-xs text-muted-foreground">
                정산연차
                <Input
                  type="number"
                  min={1}
                  max={협약연수}
                  placeholder="마지막"
                  value={정산연차}
                  onChange={(e) => set정산연차(e.target.value)}
                  className="mt-1 h-7 w-[110px] text-[13px] tabular-nums"
                  aria-label="정산연차"
                />
              </label>
            )}
            <span className="pb-1 text-xs text-muted-foreground">
              두 칸은 지금 올리는 파일에 같이 붙습니다. 비워 두면 안 적습니다 — 지어내지 않습니다.
            </span>
          </div>
        )}

        {정산서류_기본.map((종류) => (
          <DocSlot key={종류} {...자리props(종류)} />
        ))}
        <DocSlot {...자리props("기타")} />

        {/* 기본 세 자리·기타에 안 걸리는 종류로 올라온 것(예: 이자 반납 증빙)도 보여준다.
            자리에 없다고 목록에서 빠지면 「올렸는데 안 보인다」가 된다. */}
        {기타.filter((d) => d.서류종류 !== "기타").length > 0 && (
          <ul className="space-y-1 rounded-lg border p-3">
            {기타
              .filter((d) => d.서류종류 !== "기타")
              .map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                  <span className="font-medium">{d.서류종류}</span>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    disabled={pending}
                    onClick={() => 내려받기(d.id)}
                  >
                    {d.파일명}
                  </button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {KB(d.크기)} · {시각(d.업로드일시)}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    onClick={() => 지우기(d.id, d.파일명)}
                  >
                    지우기
                  </button>
                </li>
              ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          파일은 비공개 저장소에 들어가고 내려받을 때만 60초 서명 주소가 만들어집니다 — 공개 주소가
          존재하지 않습니다. 반려되어 다시 냈으면 <b>덮어쓰지 않고 새로 올립니다</b> — 두 번 낸
          이력이 남아야 왜 그랬는지 설명할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
