"use client"

import * as React from "react"
import Link from "next/link"
import { ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 오늘 처리할 것 — 「비목 확정」·「챙길 서류」·「제출 전 점검」 세 갈래를 한 카드에 담는다.
 *
 * 2026-09-04 개편(6차) — 갈래 소제목·`divide-y` 큰 구획을 걷어내고 **한 줄짜리 통합
 * 목록 + 배지**로 바꿨다.
 *   ⚠ **0건 갈래는 아예 안 보여준다.** 「걸린 게 생길 때마다 뜨게」가 이 카드의 기준이다.
 *   ⚠ **셋 다 0건이면 카드는 남기고 안에 「지금 손댈 것이 없습니다」를 띄운다.**
 *     이 카드는 오른쪽 열에서 `flex-1` 로 남는 세로 공간을 흡수하는 역할도 겸한다.
 *   ⚠ **갈래마다 색을 다르게 준 작은 배지**로 구분한다(대기=인디고·서류=청록·
 *     점검=슬레이트 — 이 앱에서 아직 안 쓴 색들이다).
 *
 * 2026-09-04 개편(9차) — 오른쪽 값을 「행동 문구」로 바꿨다(없음→발급 필요 등).
 *   `StatusBadge`(다른 화면과 공유하는 컴포넌트·어휘)는 안 건드리고 이 카드
 *   안에서만 매핑한다(`행동문구()`).
 *
 * 2026-09-04 개편(10차) — **갈래별 페이지 넘김을 버리고 카드 전체 통합 페이지로
 * 바꿨다.**
 *   ⚠ 그룹마다 따로 페이지를 넘기면 **그룹 하나의 높이는 고정돼도, 여러 그룹이
 *     동시에 여러 페이지가 되면 전체 합은 계속 늘어난다**(대기 6건+서류 6건이면
 *     각자 4줄씩 고정이어도 합쳐서 8줄이 카드에 들어간다). 그룹이 늘수록 카드가
 *     다시 커진다 — 애초에 카드 크기를 고정하려던 목적과 어긋난다.
 *   ⚠ 그래서 **모든 갈래의 항목을 한 줄로 펼쳐 놓고 카드 전체가 한 페이지당
 *     고정 줄 수(`페이지당`)로 넘어간다.** 데이터가 아무리 많아져도 한 페이지에
 *     보이는 줄 수는 항상 같다 — 카드 높이가 데이터양과 완전히 무관해진다.
 *   ⚠ **그룹이 페이지 중간에서 갈릴 수 있다**(예: 2페이지에 대기 마지막 1건과
 *     서류 앞부분이 같이 보임). 각 줄 앞의 갈래 배지가 항상 붙어 있어서 어느
 *     갈래인지는 줄마다 바로 알 수 있다 — 그룹 경계가 안 맞아도 헷갈리지 않는다.
 *   ⚠ 페이지 넘김 버튼은 카드에 **딱 하나**다. 여러 갈래가 동시에 여러 페이지일
 *     때 버튼이 여러 개 뜨는 것보다 하나가 낫다는 판단(2026-09-04 사용자 확인).
 *
 * 2026-09-04 개편(12차) — **이름과 조치 사이에 "무엇을" 한 칸을 더 넣었다.**
 *   ⚠ 예전엔 "○○컴퓨터 — 확정 필요"처럼 무슨 비목인지, 어느 과제의 뭐가 문제인지
 *     안 보였다(눌러서 원본 화면까지 가야 알 수 있었다 — 사용자 지적). `상세` 필드로
 *     그 정보를 채운다: 비목 확정→비목명, 챙길 서류→상태(만료됨 등), 제출 전
 *     점검→점검 대상·종류.
 *   ⚠ **이름은 폭을 제한하고(`max-w-[45%]`), 상세가 남는 공간(`flex-1`)을 가져간다.**
 *     둘 다 truncate 인데 우선순위가 반대면(이름이 flex-1) 과제명이 길 때 뒤의
 *     상세("기한임박 - 중간보고")가 통째로 잘려서 안 보이는 문제가 생긴다(실측
 *     확인). 이름이 길면 이름 쪽이 먼저 잘리게 해서 상세는 항상 최대한 보이게 한다.
 */
export type 큐항목 = {
  키: string
  이름: string
  꼬리: string
  /** 이름과 조치 사이에 보여줄 보충 설명. 없으면 그 칸을 비운다. */
  상세?: string | null
  /** 꼬리를 상태 배지로 그릴지. 「만료」·「없음」처럼 값이 상태일 때만 참. */
  배지?: boolean
}

export type 큐갈래 = {
  라벨: string
  링크: string
  건수: number
  항목: 큐항목[]
}

/** 갈래 이름 → 짧은 배지 글자·색. 여기 없는 갈래가 오면 회색 테두리로 무난하게 그린다. */
const 갈래스타일: Record<string, { 짧은: string; 색: string }> = {
  "비목 확정": {
    짧은: "대기",
    색: "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
  "챙길 서류": {
    짧은: "서류",
    색: "border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  "제출 전 점검": {
    짧은: "점검",
    색: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-400",
  },
}

type 행동 = { 문구: string; 색?: string }

/**
 * 오른쪽에 보여줄 행동 문구. 원본 값(`꼬리`)은 `/expenses`·`/documents`·`/programs`
 * 가 쓰는 공용 어휘라 안 건드리고, 이 카드에서 보여줄 때만 여기서 한 번 바꾼다.
 *
 * ⚠ 챙길 서류의 「만료」→「발급 필요」·「만료임박」→「갱신 필요」는 일부러 이렇게
 *   갈랐다(2026-09-04 사용자 확인). 이미 완전히 만료된 서류는 갱신이 아니라
 *   재발급 대상으로 본다 — 아직 안 지났을 때만 미리 갱신한다는 뜻.
 */
function 행동문구(갈래: string, 꼬리: string): 행동 {
  if (갈래 === "챙길 서류") {
    if (꼬리 === "만료") return { 문구: "발급 필요", 색: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400" }
    if (꼬리 === "만료임박") return { 문구: "갱신 필요", 색: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" }
    if (꼬리 === "없음") return { 문구: "발급 필요", 색: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" }
    return { 문구: 꼬리 }
  }
  if (갈래 === "비목 확정") return { 문구: "확정 필요" }
  if (갈래 === "제출 전 점검") return { 문구: "미해결" }
  return { 문구: 꼬리 }
}

/**
 * 이름과 조치 사이에 넣을 보충 설명. 챙길 서류는 원본 상태값(`꼬리`)을 이 카드에서만
 * 사람 말로 바꾸고(행동문구와 같은 이유), 나머지 갈래는 대시보드가 이미 사람이 읽을
 * 말로 만들어 보낸 `상세`를 그대로 쓴다.
 */
function 상세문구(갈래: string, 꼬리: string, 상세?: string | null): string | null {
  if (갈래 === "챙길 서류") {
    if (꼬리 === "만료") return "만료됨"
    if (꼬리 === "만료임박") return "만료일 다가옴"
    if (꼬리 === "없음") return "미발급"
    return null
  }
  return 상세 ?? null
}

/** 통합 목록의 한 줄 — 원래 갈래 정보를 들고 다닌다(배지·링크·색을 찾으려면 필요하다). */
type 통합행 = { 갈래: string; 링크: string } & 큐항목

const 페이지당 = 5

export function TodoCard({ 갈래들 }: { 갈래들: 큐갈래[] }) {
  const 걸린것 = 갈래들.filter((g) => g.건수 > 0)
  const 총건수 = 갈래들.reduce((n, g) => n + g.건수, 0)

  // 모든 갈래를 한 줄 목록으로 펼친다 — 순서는 갈래 순서(대기→서류→점검)를 유지한다.
  const 전체행: 통합행[] = React.useMemo(
    () => 걸린것.flatMap((g) => g.항목.map((it) => ({ 갈래: g.라벨, 링크: g.링크, ...it }))),
    [걸린것],
  )

  const [페이지, set페이지] = React.useState(0)
  const 총페이지 = Math.max(1, Math.ceil(전체행.length / 페이지당))
  const 현재페이지 = Math.min(페이지, 총페이지 - 1)
  const 보이는행 = 전체행.slice(현재페이지 * 페이지당, 현재페이지 * 페이지당 + 페이지당)

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      {/* 2026-09-04 심사용 최종본 — 헤더를 "공고 확인"(announcement-board.tsx)과
          같은 모양으로 맞췄다: 아이콘 배지 + 제목 + 오른쪽 건수. 대시보드 카드끼리
          첫인상이 다르면 한 화면인데도 따로 만든 것처럼 보인다는 지적(심사용). */}
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ListChecks className="size-3.5" />
          </span>
          <h2 className="text-sm font-semibold">확인 및 조치</h2>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{총건수}건</span>
      </div>

      {걸린것.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[14.3px] text-muted-foreground">
          지금 손댈 것이 없습니다
        </p>
      ) : (
        /* 2026-09-04 심사용 최종본 — 줄을 고정 높이(h-8)로 쌓지 않고 flex-col +
           flex-1 로 5칸이 카드 남는 세로 공간을 똑같이 나눠 갖게 한다. 왼쪽 달력
           카드가 길어서(팀원이 일정 목록을 늘림) 이 카드가 flex-1 로 따라 늘어나면,
           줄은 그대로 h-8 인데 카드만 커져서 밑에 빈칸이 크게 남았다(사용자 지적,
           "아래 빈칸이 너무 많아"). 5칸이 남는 높이를 나눠 가지면 빈칸 없이 카드
           높이만큼 꽉 찬다. */
        <div className="flex flex-1 flex-col overflow-y-auto p-2.5">
          {보이는행.map((it, i) => {
            const 스타일 = 갈래스타일[it.갈래] ?? {
              짧은: it.갈래.slice(0, 2),
              색: "border-border text-muted-foreground",
            }
            const 행동 = 행동문구(it.갈래, it.꼬리)
            const 상세 = 상세문구(it.갈래, it.꼬리, it.상세)
            // 갈래가 바뀌는 지점만 진하게, 나머지 줄 사이는 옅게 — 줄마다 간격이
            // 눈에 똑같이 잡혀야 훑기 편하다(2026-09-04 심사용, 간격 불규칙 지적).
            const 갈래바뀜 = i > 0 && 보이는행[i - 1].갈래 !== it.갈래

            return (
              <Link
                key={it.키}
                href={it.링크}
                data-group={it.갈래}
                title={it.꼬리 !== 행동.문구 ? `원래 값: ${it.꼬리}` : undefined}
                className={cn(
                  // 이름 칸을 128→184px 로 넓혔다(2026-09-04) — "4대보험 가입자명부"처럼
                  // 긴 서류명이 잘려 보인다는 지적. 상세 칸은 좁혔다가(200px 고정)
                  // 사용자가 원래(1fr)로 되돌려 달라고 해서 되돌린다.
                  // 칸 사이 gap 만 3→2 로 살짝 좁혔다(2026-09-04, "조금만 좁게") — 칸
                  // 폭 자체(1fr)는 그대로 둔다. 폭을 고정하면 총사업비 칸 배지 정렬이
                  // 다시 어긋난 적이 있어(실측 사고) gap 만 건드리는 쪽이 안전하다.
                  "grid flex-1 min-h-8 grid-cols-[44px_184px_1fr_80px] items-center gap-2 rounded px-1.5 hover:bg-muted",
                  // ⚠ margin 이 아니라 border 를 쓴다. margin-top 은 줄 높이 바깥에 공간을
                  //   더하는데, 페이지마다 그 페이지 안에서 갈래가 몇 번 바뀌는지가 달라서
                  //   페이지 넘길 때마다 카드 높이가 246px→240px 로 흔들렸다(실측).
                  //   border 는 h-8 박스 안에서(box-border) 자리를 차지해 높이가 안 늘어난다.
                  i > 0 && (갈래바뀜 ? "border-t border-border/70" : "border-t border-border/25"),
                )}
              >
                {/* 2026-09-04 심사용 최종본 — flex 고정폭 대신 grid 고정 칸(44·128·1fr·80)으로
                    바꿨다. flex 는 gap 이 내용 길이에 따라 살짝 밀리는데, grid 칸은 내용과
                    무관하게 항상 같은 자리다. 칸마다 내용도 가운데 정렬한다 — 왼쪽 정렬이면
                    글자 길이가 다른 줄마다 시작점은 같아도 "가운데 줄"이 안 맞아 보인다는
                    지적(심사용). */}
                {/* ⚠ 배지도 w-11/w-20 같은 고정 rem폭 대신 w-full 을 쓴다 — 폰트 110%
                    확대(전역 font-size)에서 rem 폭이 grid 칸의 실제 px 폭(44·80)보다
                    커져 배지가 칸 밖으로 살짝 삐져나오는 걸 실측으로 확인했다(사용자
                    지적 "간격이 다 맞는거야?"). w-full 은 항상 칸 폭 그대로다. */}
                <span
                  className={cn(
                    "inline-flex h-5 w-full shrink-0 items-center justify-center rounded border text-[12.1px] font-medium leading-none",
                    스타일.색,
                  )}
                >
                  {스타일.짧은}
                </span>
                <span className="w-full truncate text-center text-sm">{it.이름}</span>
                <span className="min-w-0 truncate text-center text-xs text-muted-foreground">
                  {상세 ?? ""}
                </span>
                {행동.색 ? (
                  <span
                    className={cn(
                      "inline-flex h-5 w-full shrink-0 items-center justify-center rounded border px-1.5 text-[12.1px] font-medium leading-none",
                      행동.색,
                    )}
                  >
                    {행동.문구}
                  </span>
                ) : (
                  <span className="w-full truncate text-center text-xs text-muted-foreground">
                    {행동.문구}
                  </span>
                )}
              </Link>
            )
          })}

          {/* 줄 수를 고정한다 — 데이터가 아무리 많아져도 카드 안 표시 줄 수는 항상 같다. */}
          {Array.from({ length: 페이지당 - 보이는행.length }).map((_, i) => (
            <div key={`filler-${i}`} aria-hidden className="flex-1 min-h-8" />
          ))}
        </div>
      )}

      {/* 카드에 페이지 넘김 버튼은 하나뿐이다 — 갈래마다 따로 두면 갈래가 늘수록
          버튼도 늘고 카드 안 표시 줄 수도 같이 늘어난다. */}
      {총페이지 > 1 && (
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <button
            type="button"
            disabled={현재페이지 === 0}
            onClick={() => set페이지((p) => p - 1)}
            aria-label="이전 페이지"
            className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            ‹
          </button>
          <span className="tabular-nums">
            {현재페이지 + 1} / {총페이지}
          </span>
          <button
            type="button"
            disabled={현재페이지 >= 총페이지 - 1}
            onClick={() => set페이지((p) => p + 1)}
            aria-label="다음 페이지"
            className="flex size-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
