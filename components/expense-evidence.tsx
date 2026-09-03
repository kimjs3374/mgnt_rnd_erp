"use client"

import * as React from "react"
import {
  uploadEvidenceFile,
  getEvidenceDownloadUrl,
  deleteEvidenceFile,
} from "@/app/actions/evidence-files"
import type { EvidenceRequirement, EvidenceFile } from "@/lib/evidence-types"
import { 문서파일_점검 } from "@/lib/upload-limits"
import { useFileDrop, 드롭강조 } from "@/components/use-file-drop"

/**
 * 집행 한 건의 증빙 — 요건 다섯(구매의뢰서 · 지출결의서 · 거래명세서 · 세금계산서 · 검수조서)과 첨부 파일.
 *
 * 실제 폴더가 `01. 연구재료비\(주)천보\2024.06.21\` 처럼 **거래처·날짜(=집행 건)** 아래에
 * 번호 붙은 서류를 두고 있었다. RCMS 도 건별로 묶어 제출하니 화면 단위도 건이어야 한다.
 * 비목 단위 보관은 계상 탭(`EvidenceAttachments`)이 맡는다 — 여기는 「이 건」만 본다.
 *
 * **드래그드랍 — 놓는 자리가 곧 분류다.** 계상 탭과 같은 규칙이고 같은 훅을 쓴다
 * (`components/use-file-drop.ts`). 두 화면이 다르게 굴면 사람이 매번 다시 배워야 한다.
 *   서류 줄 위 → 그 요건 / 카드 여백 → 기타 첨부 / 개인정보 서류 줄 → 안 받고 이유를 말한다
 * **파일명으로 요건을 추측해 자동 배치하지 않는다.** `3. 천보_지출결의서.pdf` 가 지출결의서일
 * 확률이 높아도 추측이고, 잘못 붙으면 「확보」 숫자가 조용히 거짓말을 한다(CLAUDE.md §6-5).
 *
 * 「한 번에 다운로드」는 서명 URL 을 여러 개 열지 않고 서버가 zip 으로 묶어 보낸다
 * (`/api/evidence/zip?expense=<id>`). 팝업 차단에 걸리지 않고, 받는 사람이 원하는 건
 * 파일 넷이 아니라 한 묶음이다.
 */

const KB = (n: number | null) =>
  n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`

/** ISO → `09-03 20:41` (KST). 서버·클라이언트가 같은 값을 내도록 직접 계산한다. */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

export function ExpenseEvidence({
  과제_id,
  집행_id,
  비목_대분류,
  요건,
  파일,
}: {
  과제_id: number
  집행_id: number
  비목_대분류: string | null
  /** 집행단위 = true 인 요건만 넘긴다. */
  요건: EvidenceRequirement[]
  /** 이 집행 건에 붙은 파일만 넘긴다. */
  파일: EvidenceFile[]
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()

  const rs = 요건.filter((r) => r.비목_대분류 === 비목_대분류).sort((a, b) => a.순번 - b.순번)
  const 확보 = rs.filter((r) => 파일.some((f) => f.요건_id === r.id)).length
  const 기타 = 파일.filter((f) => !rs.some((r) => r.id === f.요건_id))

  const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })

  function 올리기(요건_id: number | null, files: File[]) {
    const 고른것 = files.filter(Boolean)
    if (!고른것.length || !비목_대분류) return
    if (pending) {
      setMsg({ ok: false, text: "앞의 파일을 올리는 중입니다. 끝난 뒤에 놓으세요." })
      return
    }
    setMsg(null)

    // 크기·확장자는 서버가 최종 판정하지만 여기서 먼저 거른다(`lib/upload-limits.ts` 한 벌).
    // 드롭은 한 번에 여러 개라, 못 받을 파일을 끝까지 올려보낸 뒤 거절하면 그 시간이 곱절로 날아간다.
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
        fd.set("비목_대분류", 비목_대분류)
        fd.set("집행_id", String(집행_id))
        if (요건_id != null) fd.set("요건_id", String(요건_id))
        fd.set("file", f)
        const r = await uploadEvidenceFile(fd)
        if (r.ok) 성공.push(f.name)
        else 실패.push(`${f.name} — ${r.error ?? "올리지 못했습니다."}`)
      }
      setMsg(
        실패.length
          ? { ok: false, text: [성공.length ? `${성공.length}개 올렸습니다.` : "", ...실패].filter(Boolean).join(" / ") }
          : { ok: true, text: 성공.length === 1 ? `${성공[0]} 올렸습니다.` : `${성공.length}개 올렸습니다.` },
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

  function 지우기(id: number) {
    setMsg(null)
    start(async () => {
      const r = await deleteEvidenceFile(id)
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "지우지 못했습니다." })
    })
  }

  if (!비목_대분류) {
    return (
      <section className="rounded-lg border bg-card p-3 text-[13px] text-muted-foreground">
        비목이 아직 정해지지 않아 증빙 요건을 알 수 없습니다. 비목을 확정하면 필요한 서류가 여기 뜹니다.
      </section>
    )
  }

  const 기타키 = `건:${집행_id}:기타`

  return (
    // 카드 여백에 놓으면 「기타 첨부」다. 서류 줄은 안쪽에서 propagation 을 끊어 자기가 가져간다.
    <section
      {...드롭영역(기타키, (files) => 올리기(null, files))}
      className={
        "rounded-lg border bg-card p-3 transition-colors " +
        (드롭대상 === 기타키 ? 드롭강조.카드 : "")
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">증빙 서류</span>
        <span className="text-xs">
          {rs.length ? `${확보}/${rs.length} 확보` : "이 비목은 집행 단위 요건이 없다"}
        </span>
        {rs.length > 0 && 확보 < rs.length && (
          <span className="text-xs text-destructive">미확보 {rs.length - 확보}건</span>
        )}
        {파일.length > 0 && (
          <a
            href={`/api/evidence/zip?expense=${집행_id}`}
            className="ml-auto rounded-md border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:bg-secondary/60"
          >
            전체 {파일.length}건 ZIP 다운로드
          </a>
        )}
      </div>

      <ul className="space-y-1.5 text-[12.5px]">
        {rs.map((r) => {
          const 붙은것 = 파일.filter((f) => f.요건_id === r.id)
          const 줄키 = `건:${집행_id}:요건:${r.id}`
          // 개인정보 서류는 줄 자체가 드롭을 안 받는다. 커서도 「금지」로 바뀐다.
          // 화면 검사는 우회할 수 있으므로 **서버가 여전히 최종 판정자다** — 두 겹 그대로 둔다.
          const 줄막힘 = r.개인정보포함
            ? `「${r.서류명}」은 개인 급여가 드러나는 서류라 이 시스템에 올리지 않습니다. RCMS 에 직접 제출하세요.`
            : null
          return (
            <li
              key={r.id}
              {...드롭영역(줄키, (files) => 올리기(r.id, files), 줄막힘)}
              className={
                "rounded-sm transition-colors " +
                (드롭대상 !== 줄키 ? "" : 줄막힘 ? 드롭강조.막힘 : 드롭강조.받음)
              }
            >
              <div className="flex flex-wrap items-center gap-x-2">
                {/* 순번(매그나텍 실제 제출 폴더 번호)은 정렬과 폴더 대조에만 쓰고 화면에는 안 낸다 —
                    2·3·5·7 처럼 띄엄띄엄한 번호가 앞에 붙으면 빠진 서류가 있는 것처럼 읽힌다. */}
                <span className={붙은것.length ? "text-muted-foreground" : "font-medium"}>
                  {붙은것.length ? "✓ " : "· "}
                  {r.서류명}
                </span>
                <span
                  className={
                    r.필수여부
                      ? "rounded bg-secondary px-1 py-0.5 text-[10.5px]"
                      : "rounded px-1 py-0.5 text-[10.5px] text-muted-foreground"
                  }
                >
                  {r.필수여부 ? "필수" : "해당시"}
                </span>
                <label className="ml-auto cursor-pointer rounded-md border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:bg-secondary/60">
                  {붙은것.length ? "추가" : "첨부"}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={pending || !!줄막힘}
                    onChange={(e) => {
                      올리기(r.id, Array.from(e.target.files ?? []))
                      e.target.value = ""
                    }}
                  />
                </label>
              </div>
              {붙은것.map((f) => (
                <div
                  key={f.id}
                  className="ml-6 mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground"
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
                    onClick={() => 지우기(f.id)}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </li>
          )
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
        <span className="text-[11px] text-muted-foreground">기타 첨부</span>
        <label className="cursor-pointer rounded-md border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:bg-secondary/60">
          파일 첨부
          <input
            type="file"
            multiple
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              올리기(null, Array.from(e.target.files ?? []))
              e.target.value = ""
            }}
          />
        </label>
        {/* 놓는 자리가 곧 분류라는 것을 말로 한 번 적어 둔다. 안 적으면 아무도 끌어다 놓지 않는다. */}
        <span className="text-[11px] text-muted-foreground">
          파일을 서류 줄 위에 끌어다 놓으면 그 서류로, 여백에 놓으면 기타로 붙습니다. 여러 개 한꺼번에 됩니다.
        </span>
        {pending && <span className="text-[11.5px] text-muted-foreground">처리 중…</span>}
        {msg && (
          <span className={msg.ok ? "text-[11.5px] text-muted-foreground" : "text-[11.5px] text-destructive"}>
            {msg.text}
          </span>
        )}
      </div>

      {기타.map((f) => (
        <div
          key={f.id}
          className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground"
        >
          <span className="text-foreground">{f.파일명}</span>
          <span className="tabular-nums">{KB(f.크기)}</span>
          <span className="tabular-nums">{시각(f.업로드일시)}</span>
          <span>{f.업로더}</span>
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
            onClick={() => 지우기(f.id)}
          >
            삭제
          </button>
        </div>
      ))}
    </section>
  )
}
