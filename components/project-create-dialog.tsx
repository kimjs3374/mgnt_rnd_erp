"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createProject } from "@/app/actions/project-create"
import { 과제상태값, 과제상태_설명, 사업유형_라벨 } from "@/lib/project-entry"
import type { 과제상태 } from "@/lib/project-entry"

/**
 * 대장에 **기존 사업을 옮겨 담는** 대화상자.
 *
 * ⚠ [지원 등록]과 이름도 성격도 갈라 둔다. 헷갈리면 대장이 오염된다.
 *   · [지원 등록] — 공고 상세에서. **지금부터 신청하는** 건. 공고_id 가 붙는다
 *   · [기존 사업 옮겨 담기] — 여기. **이미 하고 있거나 끝난** 건. 공고 레코드가 아예 없다
 *
 * 케이오시가 엑셀로 관리하던 10건처럼 공고가 남아 있지 않은 과거 건을 담는 길이다.
 * 이 길이 없으면 시스템을 처음 켠 회사는 대장이 영원히 빈다.
 *
 * 검증은 **막는 것과 말만 하는 것**을 갈랐다 —
 * 없으면 줄을 만들 수 없는 것(과제명·기간·총사업비)만 막고, 재원 합계 불일치처럼
 * 「틀린 게 아닐 수 있는 것」은 올려 보내되 반드시 눈에 보이게 한다.
 * 여기서 막으면 옮겨 담기가 통째로 멈춘다.
 */

const 원 = (n: number) => n.toLocaleString("ko-KR")

/** 숫자칸 — 콤마를 지우고 읽는다. 사람은 137,000,000 으로 친다. */
function 수(v: string): number | null {
  const s = v.replace(/[,\s]/g, "")
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 입력 한 칸. ⚠ **컴포넌트 이름을 한글로 짓지 않는다** — JSX 태그 판정이 소문자 ASCII
 * 기준이라 한글 이름은 변환기에 따라 내장 태그로 읽힐 수 있다. props 는 한글 그대로 쓴다.
 */
function Field({
  라벨,
  값,
  놓기,
  힌트,
  타입 = "text",
  넓게,
  필수,
}: {
  라벨: string
  값: string
  놓기: (v: string) => void
  힌트?: string
  타입?: string
  넓게?: boolean
  필수?: boolean
}) {
  return (
    <label className={"flex flex-col gap-1 text-[12.7px] text-muted-foreground " + (넓게 ? "sm:col-span-2" : "")}>
      <span>
        {라벨}
        {필수 && <span className="text-destructive"> *</span>}
        {힌트 && <span className="ml-1 text-[11.6px]">{힌트}</span>}
      </span>
      <Input
        type={타입}
        className="h-7 text-[13.8px]"
        value={값}
        onChange={(e) => 놓기(e.target.value)}
      />
    </label>
  )
}

export function ProjectCreateDialog({ 사업유형들 }: { 사업유형들: { 코드: string; 이름: string }[] }) {
  const router = useRouter()
  const [열림, set열림] = React.useState(false)
  const [pending, start] = React.useTransition()
  const [err, setErr] = React.useState<string | null>(null)
  /**
   * 성공하면 바로 닫지 않고 이 화면으로 바꾼다.
   * ① 「주의」를 조용히 흘리면 임시 과제코드가 붙은 것도, 재원이 안 맞는 것도 아무도 모른다.
   * ② 엑셀 대장 10건을 옮겨 담을 때 [하나 더 넣기]가 있어야 한 번에 끝난다.
   */
  const [결과, set결과] = React.useState<
    { id: number; 과제코드: string; 과제명: string; 주의: string[] } | null
  >(null)

  const [과제명, set과제명] = React.useState("")
  const [과제코드, set과제코드] = React.useState("")
  const [사업유형, set사업유형] = React.useState("")
  const [부처, set부처] = React.useState("")
  const [전문기관, set전문기관] = React.useState("")
  const [사업명, set사업명] = React.useState("")
  const [협약번호, set협약번호] = React.useState("")
  const [시작일, set시작일] = React.useState("")
  const [종료일, set종료일] = React.useState("")
  const [연차, set연차] = React.useState("1")
  const [총사업비, set총사업비] = React.useState("")
  const [정부지원금, set정부지원금] = React.useState("")
  const [현금, set현금] = React.useState("")
  const [현물, set현물] = React.useState("")
  const [상태, set상태] = React.useState<과제상태>("수행중")
  const [비고, set비고] = React.useState("")

  function 비우기() {
    for (const f of [
      set과제명, set과제코드, set사업유형, set부처, set전문기관, set사업명,
      set협약번호, set시작일, set종료일, set총사업비, set정부지원금, set현금, set현물, set비고,
    ]) f("")
    set연차("1")
    set상태("수행중")
    setErr(null)
  }

  // 살아 있는 검산. 서버도 같은 것을 보지만 **막지는 않는다** — 현물 산정이 협약 뒤에
  // 정해지는 사업도 있어서, 여기서 막으면 옮겨 담기가 멈춘다. 보이게만 한다.
  const 총 = 수(총사업비)
  const 재원입력있음 = [정부지원금, 현금, 현물].some((v) => v.trim() !== "")
  const 재원합 = (수(정부지원금) ?? 0) + (수(현금) ?? 0) + (수(현물) ?? 0)
  const 재원어긋남 = 총 != null && 재원입력있음 && 재원합 !== 총
  const 기간뒤집힘 = !!시작일 && !!종료일 && 종료일 < 시작일

  const 낼수있나 = !!과제명.trim() && !!시작일 && !!종료일 && 총 != null && !기간뒤집힘 && !pending

  function 저장() {
    setErr(null)
    const fd = new FormData()
    const 넣기 = (k: string, v: string) => {
      if (v.trim()) fd.set(k, v.trim())
    }
    넣기("과제명", 과제명)
    넣기("과제코드", 과제코드)
    넣기("사업유형", 사업유형)
    넣기("부처", 부처)
    넣기("전문기관", 전문기관)
    넣기("사업명", 사업명)
    넣기("협약번호", 협약번호)
    넣기("시작일", 시작일)
    넣기("종료일", 종료일)
    넣기("연차", 연차)
    넣기("총사업비", 총사업비)
    넣기("정부지원금", 정부지원금)
    넣기("기관부담_현금", 현금)
    넣기("기관부담_현물", 현물)
    fd.set("상태", 상태)
    넣기("비고", 비고)

    const 넣은이름 = 과제명.trim()
    start(async () => {
      const r = await createProject(fd)
      if (!r.ok || !r.id) {
        setErr(r.error ?? "만들지 못했습니다.")
        return
      }
      set결과({ id: r.id, 과제코드: r.과제코드 ?? "", 과제명: 넣은이름, 주의: r.주의 ?? [] })
      비우기()
      // 대장 숫자가 바로 늘어야 한다. 서버가 revalidate 했어도 이 화면은 클라이언트라 새로 읽는다.
      router.refresh()
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-7 text-[14.1px]"
        onClick={() => set열림(true)}
      >
        + 기존 사업 옮겨 담기
      </Button>

      <Dialog
        open={열림}
        onOpenChange={(o) => {
          if (o || pending) return
          set열림(false)
          set결과(null)
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          {결과 ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">대장에 넣었습니다</DialogTitle>
                <DialogDescription>
                  {결과.과제명} · {결과.과제코드}
                </DialogDescription>
              </DialogHeader>

              {결과.주의.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {결과.주의.map((w, i) => (
                    <li key={i} className="text-[13.2px] text-[var(--warning-fg)]">
                      · {w}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.8px] text-muted-foreground">
                  걸리는 것 없이 들어갔습니다. 이제 그 과제 안에서 연구비를 계상할 수 있습니다.
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 text-[14.1px]"
                  onClick={() => set결과(null)}
                >
                  하나 더 넣기
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="ml-auto h-7 text-[14.1px]"
                  onClick={() => {
                    set열림(false)
                    set결과(null)
                  }}
                >
                  대장으로
                </Button>
                <Button
                  type="button"
                  className="h-7 text-[14.1px]"
                  onClick={() => {
                    set열림(false)
                    set결과(null)
                    router.push(`/projects/${결과.id}/budget`)
                  }}
                >
                  연구비 계상 하러 가기
                </Button>
              </div>
            </>
          ) : (
          <>
          <DialogHeader>
            <DialogTitle className="text-base">기존 사업 옮겨 담기</DialogTitle>
            <DialogDescription>
              엑셀 대장에 있던 <b>이미 하고 있거나 끝난</b> 사업을 대장 한 줄로 만듭니다. 지금부터
              신청하는 건은 여기가 아니라 <b>공고 상세의 [지원 등록]</b>으로 넣으세요 — 그쪽은 공고가
              같이 붙어서 그 공고의 규정·한도가 적용됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
            <Field 라벨="과제명" 값={과제명} 놓기={set과제명} 넓게 필수 />
            <Field
              라벨="과제코드"
              값={과제코드}
              놓기={set과제코드}
              힌트="비우면 MANUAL-2026-001 처럼 임시로 붙입니다"
              넓게
            />

            <label className="flex flex-col gap-1 text-[12.7px] text-muted-foreground">
              <span>사업유형</span>
              <select
                className="h-7 rounded-md border bg-background px-2 text-[13.8px]"
                value={사업유형}
                onChange={(e) => set사업유형(e.target.value)}
              >
                <option value="">모름 / 해당 없음</option>
                {사업유형들.map((s) => (
                  <option key={s.코드} value={s.코드}>
                    {사업유형_라벨[s.코드] ?? s.이름}
                  </option>
                ))}
              </select>
            </label>
            <Field 라벨="부처·지자체" 값={부처} 놓기={set부처} />
            <Field 라벨="전문기관·TP" 값={전문기관} 놓기={set전문기관} />
            <Field 라벨="협약번호" 값={협약번호} 놓기={set협약번호} />

            <Field 라벨="사업명" 값={사업명} 놓기={set사업명} 힌트="공고·사업 이름" 넓게 />
            <Field 라벨="시작일" 값={시작일} 놓기={set시작일} 타입="date" 필수 />
            <Field 라벨="종료일" 값={종료일} 놓기={set종료일} 타입="date" 필수 />

            <Field 라벨="총사업비" 값={총사업비} 놓기={set총사업비} 힌트="원" 필수 />
            <Field 라벨="정부지원금" 값={정부지원금} 놓기={set정부지원금} 힌트="원" />
            <Field 라벨="기관부담 현금" 값={현금} 놓기={set현금} 힌트="원" />
            <Field 라벨="기관부담 현물" 값={현물} 놓기={set현물} 힌트="원" />

            <Field 라벨="연차" 값={연차} 놓기={set연차} />
            <label className="flex flex-col gap-1 text-[12.7px] text-muted-foreground">
              <span>상태</span>
              <select
                className="h-7 rounded-md border bg-background px-2 text-[13.8px]"
                value={상태}
                onChange={(e) => set상태(e.target.value as 과제상태)}
              >
                {과제상태값.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2 self-end pb-1 text-[12.1px] text-muted-foreground">
              {과제상태_설명[상태]}
            </div>

            <Field 라벨="비고" 값={비고} 놓기={set비고} 넓게 />
          </div>

          {/* 막지 않고 보이게만 하는 것들 */}
          <div className="flex flex-col gap-1">
            {기간뒤집힘 && (
              <span className="text-[13.2px] text-destructive">
                종료일이 시작일보다 빠릅니다.
              </span>
            )}
            {재원어긋남 && 총 != null && (
              <span className="text-[13.2px] text-[var(--warning-fg)]">
                재원 합계 {원(재원합)}원이 총사업비 {원(총)}원과 {원(Math.abs(재원합 - 총))}원
                다릅니다. 그대로 만들 수 있고, 연구비 계상 탭에서 맞추면 됩니다.
              </span>
            )}
            {err && <span className="text-[13.2px] text-destructive">{err}</span>}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[12.1px] text-muted-foreground">
              공고는 붙지 않습니다 — 이 길로 들어온 건은 공고 레코드가 없는 건입니다
            </span>
            <Button
              type="button"
              variant="ghost"
              className="ml-auto h-7 text-[14.1px]"
              disabled={pending}
              onClick={() => {
                비우기()
                set열림(false)
              }}
            >
              취소
            </Button>
            <Button type="button" className="h-7 text-[14.1px]" disabled={!낼수있나} onClick={저장}>
              {pending ? "만드는 중…" : "대장에 넣기"}
            </Button>
          </div>
          </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
