import type { 과제단계 } from "@/lib/project-stage"

/**
 * 단계 하나가 화면에서 어떻게 보이는가 — **줄 색과 범례를 여기 한 곳에만 둔다.**
 *
 * 왜 옮겨 왔나 (2026-09-04 사용자 지시: "지원사업이랑 과제사업이랑 통일해야 되고
 * 기준은 과제사업 기준으로 동일하게 맞춰야 함")
 *   `components/projects-ledger.tsx`(과제사업)와 `components/programs-table.tsx`
 *   (지원사업)가 **같은 표를 각자 복붙해서** 들고 있었다. 두 파일의 주석에 이미
 *   "두 화면이 정의를 따로 들고 있으면 한쪽만 고쳤을 때 색이 갈린다"고 적혀 있었고,
 *   실제로 범례 설명 문구는 이미 갈려 있었다(수행중·사업종료). 색이 같은지 눈으로
 *   대조하는 것으로는 안 갈린다는 보장을 못 만든다 — 정의를 하나로 만들어야 한다.
 *
 * 기준은 **과제사업**이다. 문구도 과제사업 쪽을 그대로 가져왔다 — 둘 중 하나를 골라야
 * 하는데 고르는 기준이 정해져 있으면 다음에 또 안 갈린다.
 *
 * ⚠ 키는 **저장된 `상태` 가 아니라 계산된 단계**다(`lib/project-stage.ts` 의 `단계판정`).
 *   저장값으로 칠하면 「배지는 신청완료인데 줄 색은 신청중」이 된다(실제로 났던 일).
 * ⚠ `TableRow` 기본 클래스에 `hover:bg-muted/50` 이 있다. `cn()`(tailwind-merge)을 거치므로
 *   hover 색을 같이 안 주면 마우스를 올렸을 때 칠한 색이 사라진다(종료 줄에서 겪은 함정).
 */
export const 단계색: Record<string, string> = {
  신청중: "bg-amber-50/50 hover:bg-amber-100/60 dark:bg-amber-950/40 dark:hover:bg-amber-900/50",
  신청완료: "bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-800/50",
  수행중: "bg-sky-50/50 hover:bg-sky-100/60 dark:bg-sky-950/40 dark:hover:bg-sky-900/50",
  사업종료: "bg-red-100/40 hover:bg-red-200/50 dark:bg-red-950/60 dark:hover:bg-red-900/60",
  미선정: "bg-slate-100/60 hover:bg-slate-200/60 dark:bg-slate-800/40 dark:hover:bg-slate-700/50",
}

/** 범례에 쓰는 스와치 색(hover 뺀 배경만) + 이름. 순서가 곧 범례 순서다. */
export const 단계범례: { 상태: 과제단계; 스와치: string; 이름: string; 설명: string }[] = [
  {
    상태: "신청중",
    스와치: "bg-amber-50/50 dark:bg-amber-950/40",
    이름: "신청중",
    설명: "접수했고 발표·심사를 기다리는 중입니다.",
  },
  {
    상태: "신청완료",
    스와치: "bg-amber-100/60 dark:bg-amber-900/40",
    이름: "신청완료",
    설명: "발표·심사까지 마치고 최종 결과만 남았습니다.",
  },
  {
    상태: "수행중",
    스와치: "bg-sky-50/50 dark:bg-sky-950/40",
    이름: "수행중",
    설명: "협약기간 안에서 계상·집행·정산을 합니다.",
  },
  {
    상태: "사업종료",
    스와치: "bg-red-100/40 dark:bg-red-950/60",
    이름: "사업종료",
    설명: "끝난 건입니다 — 문제가 있다는 뜻이 아닙니다.",
  },
  {
    상태: "미선정",
    스와치: "bg-slate-100/60 dark:bg-slate-800/40",
    이름: "미선정",
    설명: "신청했지만 떨어진 건입니다.",
  },
]
