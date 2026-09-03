import Link from "next/link"
import { StatusBadge } from "@/components/status-badge"

/**
 * 큐 카드 — 「비목 확정」·「챙길 서류」·「제출 전 점검」이 각각 한 장씩 쓴다.
 *
 * 예전에는 셋이 「기다리는 일」이라는 카드 하나 안에 묶여 있었는데, 묶음 머리와 항목의
 * 들여쓰기가 같아서 어디서 끊기는지 안 보였다(2026-09-03 지적). 카드로 쪼개면
 * 그 문제가 원천적으로 없어진다 — 카드 제목이 곧 묶음 이름이다.
 *
 * 2026-09-03 개편(2차) — **0건이어도 카드를 그대로 둔다.**
 *   전에는 0건이면 카드를 아예 안 그렸는데, 그러면 3열 격자에 구멍이 나고
 *   「기능이 없나?」로 읽힌다는 지적을 받았다. 「아무 일 없으면 조용해야 한다」는
 *   상시 켜진 **경고**에 대한 규칙이었지, **카드 자리**에 대한 규칙이 아니었다 —
 *   자리가 고정돼야 「저기 보면 된다」가 생긴다. 그래서 카드는 항상 두고,
 *   0건일 때는 안이 조용해진다(회색 문구 한 줄, 배지·색 없음).
 * ⚠ 힌트 문구를 넣지 않는다. 예전엔 「확정 대기」 옆에 「AI 제안 → 사람이 눌러야 넘어간다」가
 *   붙어 있었는데, 설명이 이름보다 길어서 이름이 묻혔다. 자세한 건 링크를 눌러 들어가 본다.
 */
export type 큐항목 = {
  키: string
  이름: string
  꼬리: string
  /** 꼬리를 상태 배지로 그릴지. 「만료」·「없음」처럼 값이 상태일 때만 참. */
  배지?: boolean
}

export function QueueCard({
  라벨,
  링크,
  건수,
  항목,
  최대 = 4,
}: {
  라벨: string
  링크: string
  건수: number
  항목: 큐항목[]
  최대?: number
}) {
  const 보이는 = 항목.slice(0, 최대)
  const 나머지 = 건수 - 보이는.length

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <Link href={링크} className="text-sm font-semibold hover:underline">
          {라벨}
        </Link>
        <span className="text-xs tabular-nums text-muted-foreground">{건수}건</span>
      </div>

      {건수 === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
          걸린 것이 없습니다
        </p>
      ) : (
        <ul className="p-2">
          {보이는.map((it) => (
            <li key={it.키}>
              <Link
                href={링크}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{it.이름}</span>
                <span className="shrink-0">
                  {it.배지 ? (
                    <StatusBadge value={it.꼬리} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{it.꼬리}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
          {나머지 > 0 && (
            <li className="px-2 pt-1 text-xs text-muted-foreground">
              <Link href={링크} className="hover:underline">
                외 {나머지}건
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
