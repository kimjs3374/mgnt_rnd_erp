"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  uploadEvidenceFile,
  getEvidenceDownloadUrl,
  deleteEvidenceFile,
} from "@/app/actions/evidence-files"
import type { EvidenceRequirement, EvidenceFile } from "@/lib/evidence-types"

/**
 * 비목별 RCMS 증빙 첨부.
 *
 * **계상한 비목이 곧 준비해야 할 증빙 목록이 된다.** 인건비를 계상했으면 참여연구원 현황표가,
 * 재료비를 계상했으면 견적서·지출결의서·발주서·거래명세서·세금계산서·검수조서가 떠 있다.
 * 요건 목록은 지어낸 것이 아니라 **매그나텍이 실제로 제출한 폴더의 파일 번호 1~7**과
 * 공고 원문(연구수당·간접비 산출근거)에서 나왔다 — `db/95_project_evidence.sql` 참조.
 *
 * ⚠ 개인정보 서류(급여이체증·4대보험 명부·지급대장)는 **요건으로만 표시하고 업로드 칸을 주지 않는다.**
 *   목록에서 지우면 「빠진 서류」를 셀 수 없고, 올리게 하면 절대 규칙을 깬다.
 */

// 행 타입은 `lib/evidence-types.ts` 에 있다 — 서버 조회(queries-project)와 같은 타입을 써야
// 컬럼이 바뀔 때 한 곳만 고치면 된다. `lib/queries-project.ts` 는 server-only 라 여기서 못 읽는다.
export type Req = EvidenceRequirement
export type { EvidenceFile }

const KB = (n: number | null) =>
  n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`

/** ISO 문자열 → `09-03 19:40` (KST). 서버·클라이언트가 같은 값을 내야 하므로 직접 계산한다. */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

export function EvidenceAttachments({
  과제_id,
  요건,
  파일,
  비목이름,
  계상비목,
  로그인,
}: {
  과제_id: number
  요건: Req[]
  파일: EvidenceFile[]
  비목이름: Record<string, string>
  /** 배정액이 0 보다 큰 비목. 이 순서대로 카드를 만든다. */
  계상비목: string[]
  로그인: boolean
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()
  const [전체보기, set전체보기] = React.useState(false)

  const 요건있는비목 = Array.from(new Set(요건.map((r) => r.비목_대분류)))
  const 보일비목 = 전체보기
    ? Array.from(new Set([...계상비목, ...요건있는비목]))
    : 요건있는비목.filter((c) => 계상비목.includes(c))

  function 올리기(비목: string, 요건_id: number | null, f: File | null) {
    if (!f) return
    setMsg(null)
    const fd = new FormData()
    fd.set("과제_id", String(과제_id))
    fd.set("비목_대분류", 비목)
    if (요건_id != null) fd.set("요건_id", String(요건_id))
    fd.set("file", f)
    start(async () => {
      const r = await uploadEvidenceFile(fd)
      setMsg(
        r.ok
          ? { ok: true, text: `${f.name} 올렸습니다.` }
          : { ok: false, text: r.error ?? "올리지 못했습니다." },
      )
    })
  }

  function 내려받기(id: number) {
    setMsg(null)
    start(async () => {
      const r = await getEvidenceDownloadUrl(id)
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener")
      else setMsg({ ok: false, text: r.error ?? "내려받지 못했습니다." })
    })
  }

  function 지우기(id: number, 이름: string) {
    setMsg(null)
    start(async () => {
      const r = await deleteEvidenceFile(id)
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "지우지 못했습니다." })
      else setMsg({ ok: true, text: `${이름} 지웠습니다.` })
    })
  }

  const 전체필수 = 요건.filter((r) => 보일비목.includes(r.비목_대분류) && r.필수여부 && !r.개인정보포함)
  const 확보된필수 = 전체필수.filter((r) => 파일.some((f) => f.요건_id === r.id)).length

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">비목별 증빙 파일 (RCMS 제출용)</span>
        <span className="text-xs text-muted-foreground">
          필수 {전체필수.length}건 중 {확보된필수}건 확보
          {전체필수.length - 확보된필수 > 0 ? ` · 미확보 ${전체필수.length - 확보된필수}` : ""}
        </span>
        {!로그인 && (
          <span className="rounded px-1.5 py-0.5 text-[11px] text-[var(--warning-fg)]">
            로그인 전이라 업로더가 「미인증」으로 기록된다
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          className="ml-auto h-6 px-2 text-[12px] text-muted-foreground"
          onClick={() => set전체보기((v) => !v)}
        >
          {전체보기 ? "계상한 비목만" : "모든 비목 보기"}
        </Button>
      </div>

      {보일비목.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          계상한 비목이 없어 준비할 증빙도 없습니다. 위에서 비목별 배정액을 넣으면 그 비목의 RCMS
          증빙 목록이 여기 뜹니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {보일비목.map((비목) => {
            const rs = 요건
              .filter((r) => r.비목_대분류 === 비목)
              .sort((a, b) => a.순번 - b.순번)
            const fs = 파일.filter((f) => f.비목_대분류 === 비목)
            const 필수 = rs.filter((r) => r.필수여부 && !r.개인정보포함)
            const 확보 = 필수.filter((r) => fs.some((f) => f.요건_id === r.id)).length
            const 기타 = fs.filter((f) => f.요건_id == null || !rs.some((r) => r.id === f.요건_id))
            const 구분들 = Array.from(new Set(rs.map((r) => r.구분 ?? "")))

            return (
              <div key={비목} className="rounded-md border">
                <div className="flex flex-wrap items-baseline gap-2 border-b bg-secondary/30 px-3 py-2">
                  <span className="text-[12.5px] font-medium">{비목이름[비목] ?? 비목}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    필수 {확보}/{필수.length}
                  </span>
                  {확보 < 필수.length && (
                    <span className="text-[11.5px] text-destructive">
                      미확보 {필수.length - 확보}건
                    </span>
                  )}
                  {!계상비목.includes(비목) && (
                    <span className="text-[11.5px] text-muted-foreground">계상 없음</span>
                  )}
                </div>

                <div className="divide-y">
                  {구분들.map((구분) => (
                    <div key={구분 || "공통"} className="px-3 py-2">
                      {구분 && (
                        <div className="mb-1 text-[11px] tracking-wide text-muted-foreground">
                          {구분}
                        </div>
                      )}
                      <ul className="space-y-1.5">
                        {rs
                          .filter((r) => (r.구분 ?? "") === 구분)
                          .map((r) => {
                            const 붙은것 = fs.filter((f) => f.요건_id === r.id)
                            return (
                              <li key={r.id} className="text-[12.5px]">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="w-5 text-right text-[11px] text-muted-foreground tabular-nums">
                                    {r.순번 || ""}
                                  </span>
                                  <span
                                    className={
                                      붙은것.length
                                        ? "text-muted-foreground"
                                        : r.필수여부 && !r.개인정보포함
                                          ? "font-medium"
                                          : ""
                                    }
                                  >
                                    {붙은것.length ? "✓ " : r.필수여부 && !r.개인정보포함 ? "· " : "· "}
                                    {r.서류명}
                                  </span>
                                  <span
                                    className={
                                      r.필수여부
                                        ? "rounded bg-secondary px-1 py-0.5 text-[10.5px] text-foreground"
                                        : "rounded px-1 py-0.5 text-[10.5px] text-muted-foreground"
                                    }
                                  >
                                    {r.필수여부 ? "필수" : "해당시"}
                                  </span>
                                  {r.개인정보포함 ? (
                                    <span className="text-[11px] text-[var(--warning-fg)]">
                                      개인정보 — RCMS 에 직접 제출 · 여기 올리지 않는다
                                    </span>
                                  ) : (
                                    <label className="ml-auto cursor-pointer rounded-md border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:bg-secondary/60">
                                      {붙은것.length ? "파일 추가" : "파일 첨부"}
                                      <input
                                        type="file"
                                        className="hidden"
                                        disabled={pending}
                                        onChange={(e) => {
                                          올리기(비목, r.id, e.target.files?.[0] ?? null)
                                          e.target.value = ""
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>

                                {붙은것.map((f) => (
                                  <div
                                    key={f.id}
                                    className="ml-7 mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground"
                                  >
                                    <span className="text-foreground">{f.파일명}</span>
                                    <span className="tabular-nums">{KB(f.크기)}</span>
                                    <span className="tabular-nums">{시각(f.업로드일시)}</span>
                                    <span>{f.업로더}</span>
                                    {!f.업로더_인증 && (
                                      <span className="text-[var(--warning-fg)]">미인증</span>
                                    )}
                                    <button
                                      type="button"
                                      className="underline hover:text-foreground"
                                      disabled={pending}
                                      onClick={() => 내려받기(f.id)}
                                    >
                                      다운로드
                                    </button>
                                    <button
                                      type="button"
                                      className="underline hover:text-destructive"
                                      disabled={pending}
                                      onClick={() => 지우기(f.id, f.파일명)}
                                    >
                                      삭제
                                    </button>
                                  </div>
                                ))}

                                {r.원문 && (
                                  <div className="ml-7 text-[11px] text-muted-foreground">
                                    근거: {r.원문.length > 160 ? r.원문.slice(0, 160) + "…" : r.원문}
                                  </div>
                                )}
                              </li>
                            )
                          })}
                      </ul>
                    </div>
                  ))}

                  {/* 요건에 없는 파일도 버리지 않는다. 실제 폴더엔 늘 「그 밖의 것」이 있다. */}
                  <div className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">기타 첨부</span>
                      <label className="ml-auto cursor-pointer rounded-md border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:bg-secondary/60">
                        파일 첨부
                        <input
                          type="file"
                          className="hidden"
                          disabled={pending}
                          onChange={(e) => {
                            올리기(비목, null, e.target.files?.[0] ?? null)
                            e.target.value = ""
                          }}
                        />
                      </label>
                    </div>
                    {기타.length > 0 &&
                      기타.map((f) => (
                        <div
                          key={f.id}
                          className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground"
                        >
                          <span className="text-foreground">{f.파일명}</span>
                          <span className="tabular-nums">{KB(f.크기)}</span>
                          <span className="tabular-nums">{시각(f.업로드일시)}</span>
                          <span>{f.업로더}</span>
                          {!f.업로더_인증 && <span className="text-[var(--warning-fg)]">미인증</span>}
                          <button
                            type="button"
                            className="underline hover:text-foreground"
                            disabled={pending}
                            onClick={() => 내려받기(f.id)}
                          >
                            다운로드
                          </button>
                          <button
                            type="button"
                            className="underline hover:text-destructive"
                            disabled={pending}
                            onClick={() => 지우기(f.id, f.파일명)}
                          >
                            삭제
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pending && <span className="text-[12.5px] text-muted-foreground">처리 중…</span>}
        {msg && (
          <span className={msg.ok ? "text-[12.5px] text-muted-foreground" : "text-[12.5px] text-destructive"}>
            {msg.text}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          pdf·hwp·xlsx·이미지·zip · 25MB 까지 · 비공개 버킷에 저장되고 다운로드는 60초 서명 주소로 나간다
        </span>
      </div>
    </div>
  )
}
