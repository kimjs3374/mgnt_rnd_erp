"use client"

import * as React from "react"
import { 단계올리기, 종료로표시, 미선정으로표시 } from "@/app/actions/project-stage"
import type { 과제단계 } from "@/lib/project-stage"

/**
 * 줄 하나를 **다음 단계로 옮기는 버튼** — 신청중 → 신청완료 → 수행중 → 사업종료.
 * (2026-09-04 사용자 지시: "신청중인 사업을 신청하면 신청 완료로 바꿀 수 있게")
 *
 * 지원사업 대장(`programs-table.tsx`)과 과제 대장(`projects-ledger.tsx`)이 **같은 것을 쓴다.**
 * 두 화면의 단계 규칙이 애초에 같은 파일(`lib/project-stage.ts`)이라, 옮기는 버튼만 다르면
 * 「지원사업에선 되는데 과제에선 안 된다」가 된다.
 *
 * **한 번에 안 바꾼다.** 누르면 「예 / 아니오」가 뜬다 — 표 안의 작은 버튼이라 스치듯 눌리고,
 * 되돌리는 길은 없기 때문이다(되돌리기를 버튼으로 주면 「눌렀다 되돌렸다」가 기록 없이 남는다).
 *
 * 사업종료만 다른 액션을 부른다(`종료로표시`) — 그건 **기간이 끝났는지 서버가 다시 본다.**
 * 아직 수행 중인 과제를 종료로 찍는 건 단계 이동이 아니라 중단이라, 여기서 하지 않는다.
 */

const 다음단계: Partial<Record<과제단계, { 이름: 과제단계; 라벨: string; 물음: string }>> = {
  신청중: { 이름: "신청완료", 라벨: "신청 완료", 물음: "신청을 마친 것으로 옮깁니다." },
  신청완료: { 이름: "수행중", 라벨: "수행중으로", 물음: "선정되어 수행에 들어간 것으로 옮깁니다." },
  수행중: { 이름: "사업종료", 라벨: "종료로 기록", 물음: "수행기간이 끝난 것으로 기록합니다." },
}

export function StageAdvance({
  과제_id,
  단계,
  선정결과,
}: {
  과제_id: number
  단계: 과제단계
  /** 이미 결과가 적힌 건은 갈림길을 안 보여 준다. 서버가 판정한 값을 그대로 받는다. */
  선정결과?: string | null
}) {
  const 다음 = 다음단계[단계]
  const [물어보는중, set물어보는중] = React.useState<null | "다음" | "미선정">(null)
  const [말, set말] = React.useState<string | null>(null)
  const [진행중, 시작] = React.useTransition()

  const 결 = 선정결과 ?? ""
  const 결과남 = 결 === "선정" || 결 === "미선정"
  // **신청완료가 갈림길이다** — 여기서만 선정/미선정을 고른다(2026-09-04 사용자 지시).
  const 갈림길 = 단계 === "신청완료" && !결과남

  // 이미 떨어진 건은 더 갈 데가 없다. 되돌리기 버튼은 두지 않는다 —
  // 눌렀다 되돌렸다가 기록 없이 남는다.
  if (결 === "미선정") {
    return <span className="text-xs text-muted-foreground">미선정</span>
  }
  if (!다음) return null // 사업종료는 더 갈 데가 없다

  function 옮기기(무엇: "다음" | "미선정") {
    set말(null)
    시작(async () => {
      const r =
        무엇 === "미선정"
          ? await 미선정으로표시([과제_id])
          : 다음!.이름 === "사업종료"
            ? await 종료로표시([과제_id])
            : await 단계올리기([과제_id], 다음!.이름 as "신청완료" | "수행중")
      set물어보는중(null)
      // 성공하면 서버가 목록을 다시 그린다. 실패한 이유는 **화면에 적는다** —
      // 조용히 아무 일도 안 일어나면 사람은 버튼이 고장 났다고 생각한다.
      if (!r.ok) set말(r.error ?? "옮기지 못했습니다.")
    })
  }

  // 표 줄 안이다. 줄을 누르면 상세로 가는 화면이 있어 클릭이 위로 새지 않게 막는다.
  const 멈춤 = (e: React.MouseEvent) => e.stopPropagation()

  if (말) {
    return (
      <span onClick={멈춤} className="text-xs text-destructive">
        {말}{" "}
        <button type="button" className="underline" onClick={() => set말(null)}>
          닫기
        </button>
      </span>
    )
  }

  if (물어보는중) {
    return (
      <span onClick={멈춤} className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">
          {물어보는중 === "미선정"
            ? "떨어진 것으로 기록합니다. 미선정 목록으로 옮겨집니다."
            : 다음.물음}
        </span>
        <button
          type="button"
          disabled={진행중}
          onClick={() => 옮기기(물어보는중!)}
          className="rounded border px-1.5 py-0.5 font-medium hover:bg-muted disabled:opacity-50"
        >
          {진행중 ? "…" : "예"}
        </button>
        <button
          type="button"
          disabled={진행중}
          onClick={() => set물어보는중(null)}
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          아니오
        </button>
      </span>
    )
  }

  return (
    <span onClick={멈춤} className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          멈춤(e)
          set물어보는중("다음")
        }}
        className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`${다음.이름}(으)로 옮기기`}
      >
        {갈림길 ? "선정" : 다음.라벨}
      </button>
      {/* 신청완료는 **둘 중 하나**다. 「선정」만 두면 떨어진 건이 영원히 여기 남아
          「아직 결과를 기다리는 건」과 구분이 안 된다(2026-09-04 사용자 지시). */}
      {갈림길 && (
        <button
          type="button"
          onClick={(e) => {
            멈춤(e)
            set물어보는중("미선정")
          }}
          className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="미선정으로 기록"
        >
          미선정
        </button>
      )}
    </span>
  )
}
