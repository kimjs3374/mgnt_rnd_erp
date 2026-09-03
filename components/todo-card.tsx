import Link from "next/link"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/components/status-badge"

/**
 * 오늘 처리할 것 — 「비목 확정」·「챙길 서류」·「제출 전 점검」 세 갈래를 한 카드에 담는다.
 *
 * 2026-09-04 개편(6차) — 갈래 소제목·`divide-y` 큰 구획을 걷어내고 **한 줄짜리 통합
 * 목록 + 배지**로 바꿨다.
 *   ⚠ **0건 갈래는 아예 안 보여준다.** 「걸린 게 생길 때마다 뜨게」가 이 카드의 기준이다.
 *     예전(5차)엔 갈래가 카드로 따로 있어서 카드 자체가 사라지면 자리가 없어져
 *     보였는데, 지금은 「오늘 처리할 것」이라는 **상위 카드가 항상 있으므로**
 *     그 안의 갈래 하나가 줄어드는 건 「고장」으로 안 읽힌다.
 *   ⚠ **셋 다 0건이면 카드는 남기고 안에 「지금 손댈 것이 없습니다」를 띄운다.**
 *     이 카드는 오른쪽 열에서 `flex-1` 로 남는 세로 공간을 흡수하는 역할도 겸한다
 *     (`app/(app)/dashboard/page.tsx`) — 내용이 없어도 카드 자체는 사라지면 안 된다.
 *   ⚠ **갈래마다 색을 다르게 준 작은 배지**로 구분한다(대기=인디고·서류=청록·
 *     점검=슬레이트 — 이 앱에서 아직 안 쓴 색들이다). 「챙길 서류」 줄은 오른쪽에
 *     이미 `StatusBadge`(주황·빨강 계열)가 붙어 있어서, 왼쪽 배지가 같은 색 계열이면
 *     한 줄에 색이 두 겹 생겨 오히려 산만해진다 — 그래서 겹치지 않는 색만 썼다.
 *   ⚠ **같은 갈래끼리는 붙이고, 갈래가 바뀌는 지점에만 얇은 여백을 준다**(`mt-1.5`).
 *     예전에 정확히 이 모양(소제목 없이 항목만 쌓임)에서 「구분이 안 간다」는
 *     지적을 받은 적이 있다 — 이번엔 배지가 그 역할을 대신하지만, 완전히 배지에만
 *     기대지 않고 여백으로 한 번 더 갈라 둔다.
 * ⚠ 확정 대기(비목 확정)를 빠뜨리면 안 된다. 확신도 0.70 미만은 코드가 자동 확정을
 *   막게 해 뒀으므로 사람을 기다리는 줄이 반드시 생기는데, 사라지면 쌓이는 걸 아무도 모른다.
 *   — 이건 "0건일 때 표시"가 아니라 "1건이라도 있으면 반드시 표시"라는 뜻이라
 *   0건 갈래 숨기기와 부딪히지 않는다.
 */
export type 큐항목 = {
  키: string
  이름: string
  꼬리: string
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

export function TodoCard({ 갈래들 }: { 갈래들: 큐갈래[] }) {
  const 걸린것 = 갈래들.filter((g) => g.건수 > 0)
  const 총건수 = 갈래들.reduce((n, g) => n + g.건수, 0)

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">오늘 처리할 것</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{총건수}건</span>
      </div>

      {걸린것.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          지금 손댈 것이 없습니다
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          {걸린것.map((g, gi) => {
            const 스타일 = 갈래스타일[g.라벨] ?? {
              짧은: g.라벨.slice(0, 2),
              색: "border-border text-muted-foreground",
            }
            return (
              <div key={g.라벨} className={cn(gi > 0 && "mt-1.5")}>
                {g.항목.map((it) => (
                  <Link
                    key={it.키}
                    href={g.링크}
                    className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "inline-flex h-4 shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-none",
                        스타일.색,
                      )}
                    >
                      {스타일.짧은}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{it.이름}</span>
                    <span className="shrink-0">
                      {it.배지 ? (
                        <StatusBadge value={it.꼬리} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{it.꼬리}</span>
                      )}
                    </span>
                  </Link>
                ))}
                {g.건수 > g.항목.length && (
                  <p className="px-1 pt-0.5 text-xs text-muted-foreground">
                    외 {g.건수 - g.항목.length}건
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
