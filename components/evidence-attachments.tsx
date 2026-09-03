"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  uploadEvidenceFile,
  getEvidenceDownloadUrl,
  deleteEvidenceFile,
} from "@/app/actions/evidence-files"
import { 문서파일_점검 } from "@/lib/upload-limits"
import { useFileDrop, 드롭강조 } from "@/components/use-file-drop"
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
 *
 * ## 드래그드랍 (2026-09-04)
 * 실제 증빙은 탐색기 폴더에 `1 견적의뢰 · 2 견적서 · 3 지출결의서 …` 로 한 벌씩 모여 있다.
 * 한 건씩 [파일 첨부] → 대화상자 → 찾기를 일곱 번 반복하는 게 이 화면에서 제일 느린 구간이라,
 * **폴더에서 통째로 끌어다 놓는 길**을 낸다. 놓는 자리가 곧 분류다:
 *
 * - **서류 줄 위** → 그 요건으로 붙는다(가장 정확)
 * - **비목 카드 여백** → 그 비목의 「기타 첨부」로 붙는다
 * - **그 밖** → 아무 데도 안 붙고, 어디에 놓아야 하는지 말해 준다
 *
 * 파일명으로 요건을 **추측해서 자동 배치하지 않는다.** 「3. 천보_지출결의서.pdf」가 지출결의서일
 * 확률이 높아도 그건 추측이고, 잘못 붙으면 「필수 확보」 숫자가 조용히 거짓말을 한다
 * (CLAUDE.md §6-5 「모르면 모른다고 한다」). 놓은 자리는 사람이 정한 사실이다.
 *
 * 기존 [파일 첨부] 버튼은 **그대로 남긴다** — 키보드 사용자와 드래그가 안 되는 환경의 경로이고,
 * 드래그드랍은 그 위에 얹은 지름길이다.
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
  // 드롭 자리·강조·창 전체 기본동작 차단은 `components/use-file-drop.ts` 한 벌을 쓴다
  // (규정 문서함도 같은 것을 쓴다 — 함정 다섯 개를 두 곳에서 각각 막지 않는다).
  const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })

  const 요건있는비목 = Array.from(new Set(요건.map((r) => r.비목_대분류)))
  const 보일비목 = 전체보기
    ? Array.from(new Set([...계상비목, ...요건있는비목]))
    : 요건있는비목.filter((c) => 계상비목.includes(c))

  /**
   * 파일 여러 개를 한 자리에 올린다. 드래그드랍은 폴더에서 통째로 끌어오므로 여러 개가 기본이다.
   * 결과는 **건별로** 말한다 — 「3개 중 1개 실패」에서 어느 것이 왜 실패했는지 안 보이면
   * 사람이 같은 걸 또 끌어다 놓는다.
   */
  function 올리기(비목: string, 요건_id: number | null, files: File[]) {
    const 고른것 = files.filter(Boolean)
    if (!고른것.length) return
    if (pending) {
      setMsg({ ok: false, text: "앞의 파일을 올리는 중입니다. 끝난 뒤에 놓으세요." })
      return
    }
    setMsg(null)

    // 크기·확장자는 서버가 최종 판정하지만 여기서 먼저 거른다(같은 규칙을 `lib/evidence-types.ts`
    // 한 곳에서 읽는다). 25MB 넘는 걸 끝까지 올려보낸 뒤 거절하면 시연 중 몇십 초가 그냥 날아간다.
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

    start(async () => {
      const 성공: string[] = []
      const 실패: string[] = [...거절]
      // 한 건씩 차례로 보낸다. 한꺼번에 던지면 어느 파일이 실패했는지 못 짚고,
      // revalidatePath 가 겹쳐 목록이 중간 상태로 그려진다.
      for (const f of 보낼것) {
        const fd = new FormData()
        fd.set("과제_id", String(과제_id))
        fd.set("비목_대분류", 비목)
        if (요건_id != null) fd.set("요건_id", String(요건_id))
        fd.set("file", f)
        const r = await uploadEvidenceFile(fd)
        if (r.ok) 성공.push(f.name)
        else 실패.push(`${f.name} — ${r.error ?? "올리지 못했습니다."}`)
      }
      if (!실패.length) {
        setMsg({
          ok: true,
          text: 성공.length === 1 ? `${성공[0]} 올렸습니다.` : `${성공.length}개 올렸습니다.`,
        })
      } else {
        setMsg({
          ok: false,
          text: `${성공.length ? `${성공.length}개 올렸습니다. ` : ""}${실패.length}개 실패 — ${실패.join(" / ")}`,
        })
      }
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

  // 카드 바깥 여백에 떨어진 드롭. 붙일 비목을 알 수 없으니 **아무 데도 붙이지 않고** 어디에 놓아야
  // 하는지 말한다. 조용히 삼키면 사람은 올라간 줄 안다.
  const 패널막힘 =
    보일비목.length === 0
      ? "계상한 비목이 없어 아직 올릴 곳이 없습니다. 위에서 비목별 배정액을 먼저 넣으세요."
      : "여기는 붙일 비목을 알 수 없습니다. 서류 줄 위에 놓으면 그 서류로, 비목 카드 여백에 놓으면 「기타 첨부」로 들어갑니다."

  return (
    <div className="rounded-lg border bg-card p-4" {...드롭영역("패널", () => {}, 패널막힘)}>
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
            const 카드키 = `비목:${비목}`

            return (
              <div
                key={비목}
                {...드롭영역(카드키, (files) => 올리기(비목, null, files))}
                className={
                  "rounded-md border transition-colors " +
                  (드롭대상 === 카드키 ? 드롭강조.카드 : "")
                }
              >
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
                  {드롭대상 === 카드키 && (
                    <span className="ml-auto text-[11.5px] text-primary">
                      놓으면 「기타 첨부」로 들어갑니다 · 서류 줄 위에 놓으면 그 서류로
                    </span>
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
                            const 줄키 = `요건:${r.id}`
                            // 개인정보 서류는 드롭도 받지 않는다. 서버도 거부하지만(그쪽이 최종 판정),
                            // 여기서 커서부터 「금지」로 바꿔야 파일이 회선을 타지 않는다.
                            const 줄막힘 = r.개인정보포함
                              ? `「${r.서류명}」은 개인 급여가 드러나는 서류라 이 시스템에 올리지 않습니다. RCMS 에 직접 제출하세요.`
                              : null
                            return (
                              <li
                                key={r.id}
                                {...드롭영역(줄키, (files) => 올리기(비목, r.id, files), 줄막힘)}
                                className={
                                  "rounded-sm text-[12.5px] transition-colors " +
                                  (드롭대상 !== 줄키 ? "" : 줄막힘 ? 드롭강조.막힘 : 드롭강조.받음)
                                }
                              >
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
                                        multiple
                                        className="hidden"
                                        disabled={pending}
                                        onChange={(e) => {
                                          올리기(비목, r.id, Array.from(e.target.files ?? []))
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
                          multiple
                          className="hidden"
                          disabled={pending}
                          onChange={(e) => {
                            올리기(비목, null, Array.from(e.target.files ?? []))
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
        {pending && <span className="text-[12.5px] text-muted-foreground">올리는 중…</span>}
        {msg && (
          <span className={msg.ok ? "text-[12.5px] text-muted-foreground" : "text-[12.5px] text-destructive"}>
            {msg.text}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          폴더에서 끌어다 놓아도 됩니다(여러 개 한꺼번에) · pdf·hwp·xlsx·이미지·zip · 25MB 까지 ·
          비공개 버킷에 저장되고 다운로드는 60초 서명 주소로 나간다
        </span>
      </div>
    </div>
  )
}
