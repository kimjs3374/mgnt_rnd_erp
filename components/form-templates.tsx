"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFileDrop, 드롭강조 } from "@/components/use-file-drop"
import { 문서파일_점검 } from "@/lib/upload-limits"
import {
  uploadFormTemplate,
  getFormTemplateUrl,
  deleteFormTemplate,
} from "@/app/actions/form-templates"
import type { FormTemplate } from "@/lib/queries-confirm"

/**
 * 서식(양식) — **문서 통일화**.
 *
 * 여기 있던 「비목별 증빙 파일」은 뺐다. 증빙 실물은 **집행 건 단위**로 붙는 것이 맞고
 * (`components/expense-evidence.tsx` 가 집행 탭에서 이미 한다), 계상 단계에서 필요한 것은
 * 「무슨 서류를 어떤 양식으로 쓸 것인가」다.
 *
 * 그래서 이 카드는 **계상한 비목이 요구하는 서류 목록**을 세우고, 서류마다 회사 표준 양식
 * 파일 하나를 걸어 둔다. 받아서 채워 쓰면 같은 지출결의서가 과제마다 다른 모양으로 나가지 않는다.
 *
 * ⚠ 서류명은 사람이 타이핑하지 않는다 — `app.evidence_requirements` 의 이름을 그대로 쓴다.
 *   오타로 「지출결의서」와 「지출 결의서」가 갈리면 표준이 둘이 되고, 통일하려던 목적이 사라진다.
 *
 * ⚠ 개인정보 서류(급여이체증·4대보험 명부·지급대장)도 **양식은 둔다.** 막는 것은 「채운 파일」을
 *   이 시스템에 올리는 일이지, 빈 양식을 나눠 쓰는 일이 아니다. 목록에 그렇게 표시한다.
 */

export type FormReq = {
  서류명: string
  구분: string | null
  비목_대분류: string
  필수여부: boolean
  개인정보포함: boolean
  순번: number
}

const KB = (n: number | null) =>
  n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`

export function FormTemplates({
  요건,
  양식,
  사업유형,
  비목이름,
  계상비목,
  로그인,
}: {
  요건: FormReq[]
  양식: FormTemplate[]
  사업유형: string | null
  비목이름: Record<string, string>
  /** 배정액이 0 보다 큰 비목. 이 비목이 요구하는 서류만 기본으로 보여준다. */
  계상비목: string[]
  로그인: boolean
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()
  const [전체보기, set전체보기] = React.useState(false)
  const [버전, set버전] = React.useState("")
  const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })

  /**
   * 서류명 하나에 표준 하나 — **사업유형 전용이 공통을 이긴다.**
   * (`pickTemplate` 과 같은 규칙이다. 저쪽은 server-only 라 여기서 다시 쓴다.)
   */
  const 표준 = React.useCallback(
    (서류명: string) =>
      양식.find((t) => t.서류명 === 서류명 && t.사업유형 != null && t.사업유형 === 사업유형) ??
      양식.find((t) => t.서류명 === 서류명 && t.사업유형 == null) ??
      null,
    [양식, 사업유형],
  )

  // 같은 서류명이 비목마다 여러 번 나온다(지출결의서가 FACILITY·ACTIVITY·PERSONNEL 세 번).
  // 양식은 서류명 단위라 **한 줄로 합치고**, 어느 비목에서 왔는지를 옆에 적는다.
  const 목록 = React.useMemo(() => {
    const 대상 = 전체보기 ? 요건 : 요건.filter((r) => 계상비목.includes(r.비목_대분류))
    const map = new Map<string, { 서류명: string; 비목: Set<string>; 필수: boolean; 개인정보: boolean; 순번: number }>()
    for (const r of 대상) {
      const cur = map.get(r.서류명) ?? {
        서류명: r.서류명,
        비목: new Set<string>(),
        필수: false,
        개인정보: r.개인정보포함,
        순번: r.순번 || 99,
      }
      cur.비목.add(r.비목_대분류)
      cur.필수 = cur.필수 || r.필수여부
      cur.개인정보 = cur.개인정보 || r.개인정보포함
      cur.순번 = Math.min(cur.순번, r.순번 || 99)
      map.set(r.서류명, cur)
    }
    return [...map.values()].sort((a, b) => a.순번 - b.순번 || a.서류명.localeCompare(b.서류명, "ko"))
  }, [요건, 계상비목, 전체보기])

  const 등록수 = 목록.filter((r) => 표준(r.서류명) != null).length

  function 올리기(서류명: string, files: File[]) {
    const f = files[0]
    if (!f) return
    if (pending) {
      setMsg({ ok: false, text: "앞의 파일을 올리는 중입니다." })
      return
    }
    // 양식은 서류당 하나다. 여러 개를 놓으면 어느 것이 표준인지 알 수 없다.
    if (files.length > 1) {
      setMsg({ ok: false, text: "양식은 서류당 하나입니다. 파일 하나만 놓으세요." })
      return
    }
    const 문제 = 문서파일_점검(f)
    if (문제) {
      setMsg({ ok: false, text: 문제 })
      return
    }
    setMsg(null)
    const fd = new FormData()
    fd.set("서류명", 서류명)
    // 사업유형이 있으면 그 유형 전용 양식으로 둔다. 없으면 공통.
    if (사업유형) fd.set("사업유형", 사업유형)
    if (버전.trim()) fd.set("버전", 버전.trim())
    fd.set("file", f)
    start(async () => {
      const r = await uploadFormTemplate(fd)
      setMsg(
        r.ok
          ? { ok: true, text: `${서류명} 표준 양식을 ${r.교체됨 ? "교체했습니다" : "등록했습니다"}.` }
          : { ok: false, text: r.error ?? "올리지 못했습니다." },
      )
    })
  }

  function 받기(id: number) {
    setMsg(null)
    start(async () => {
      const r = await getFormTemplateUrl(id)
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener")
      else setMsg({ ok: false, text: r.error ?? "받지 못했습니다." })
    })
  }

  function 지우기(id: number, 이름: string) {
    setMsg(null)
    start(async () => {
      const r = await deleteFormTemplate(id)
      setMsg(
        r.ok
          ? { ok: true, text: `${이름} 표준 양식을 내렸습니다.` }
          : { ok: false, text: r.error ?? "지우지 못했습니다." },
      )
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="text-[14.3px] font-medium">서식 (문서 통일화)</span>
        <span className="text-xs text-muted-foreground">
          이 과제에 필요한 서류 {목록.length}종 중 표준 양식 {등록수}종 등록
        </span>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto h-6 px-2 text-[13.2px] text-muted-foreground"
          onClick={() => set전체보기((v) => !v)}
        >
          {전체보기 ? "계상한 비목만" : "모든 서류 보기"}
        </Button>
      </div>

      {목록.length === 0 ? (
        <p className="text-[14.3px] text-muted-foreground">
          계상한 비목이 없어 필요한 서류도 없습니다. 위에서 비목별 배정액을 넣으면 그 비목이 요구하는
          서류가 여기 뜨고, 서류마다 회사 표준 양식을 걸어 둘 수 있습니다.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {목록.map((r) => {
            const t = 표준(r.서류명)
            const 키 = `서식:${r.서류명}`
            return (
              <li
                key={r.서류명}
                {...드롭영역(키, (files) => 올리기(r.서류명, files))}
                className={
                  "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[13.8px] transition-colors " +
                  (드롭대상 === 키 ? 드롭강조.받음 : "")
                }
              >
                <span className="w-5 text-right text-[12.1px] text-muted-foreground tabular-nums">
                  {r.순번 === 99 ? "" : r.순번}
                </span>
                <span className={t ? "" : "font-medium"}>
                  {t ? "✓ " : "· "}
                  {r.서류명}
                </span>
                <span
                  className={
                    r.필수
                      ? "rounded bg-secondary px-1 py-0.5 text-[11.6px]"
                      : "rounded px-1 py-0.5 text-[11.6px] text-muted-foreground"
                  }
                >
                  {r.필수 ? "필수" : "해당시"}
                </span>
                <span className="text-[12.1px] text-muted-foreground">
                  {[...r.비목].map((c) => 비목이름[c] ?? c).join(" · ")}
                </span>
                {r.개인정보 && (
                  <span className="text-[12.1px] text-[var(--warning-fg)]">
                    개인정보 — 빈 양식만 공유, 채운 파일은 RCMS 에 직접
                  </span>
                )}

                {t ? (
                  <span className="ml-auto flex flex-wrap items-center gap-x-2 text-[12.7px] text-muted-foreground">
                    <span className="text-foreground">{t.파일명}</span>
                    <span className="tabular-nums">{KB(t.크기)}</span>
                    {t.버전 && <span>{t.버전}</span>}
                    {t.사업유형 == null && <span>공통</span>}
                    {/* 로그인이 아직 없다 — 확인된 업로더만 적는다(빈칸이 더 정직하다). */}
                    {t.업로더_인증 && <span>{t.업로더}</span>}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      disabled={pending}
                      onClick={() => 받기(t.id)}
                    >
                      양식 받기
                    </button>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-destructive"
                      disabled={pending}
                      onClick={() => 지우기(t.id, r.서류명)}
                    >
                      내리기
                    </button>
                  </span>
                ) : (
                  <span className="ml-auto flex items-center gap-2 text-[12.7px] text-muted-foreground">
                    표준 양식 미등록
                    <label className="cursor-pointer rounded-md border px-2 py-0.5 hover:bg-secondary/60">
                      양식 올리기
                      <input
                        type="file"
                        className="hidden"
                        disabled={pending}
                        onChange={(e) => {
                          올리기(r.서류명, Array.from(e.target.files ?? []))
                          e.target.value = ""
                        }}
                      />
                    </label>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[12.7px] text-muted-foreground">
          버전
          <Input
            className="h-6 w-40 text-[13.2px]"
            placeholder="2026-v1 (선택)"
            value={버전}
            onChange={(e) => set버전(e.target.value)}
          />
        </label>
        {pending && <span className="text-[13.8px] text-muted-foreground">처리 중…</span>}
        {msg && (
          <span className={msg.ok ? "text-[13.8px] text-muted-foreground" : "text-[13.8px] text-destructive"}>
            {msg.text}
          </span>
        )}
        <span className="ml-auto text-[12.1px] text-muted-foreground">
          서류 줄에 파일을 끌어다 놓아도 등록됩니다 · <b>서류당 표준은 하나</b>라 새로 올리면
          교체됩니다 · 여기 올린 양식은 모든 과제에서 같이 받습니다
        </span>
      </div>
    </div>
  )
}
