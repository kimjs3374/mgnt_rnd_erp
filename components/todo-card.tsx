import Link from "next/link"
import { StatusBadge } from "@/components/status-badge"

/**
 * 오늘 처리할 것 — 「비목 확정」·「챙길 서류」·「제출 전 점검」 세 갈래를 한 카드에 담는다.
 *
 * 2026-09-04 개편(5차) — 세 장이던 큐 카드(QueueCard)를 다시 한 장으로 합쳤다.
 *   왜 다시 합치나: 세 장을 가로로 나란히 두니 테두리·헤더가 세 번 반복돼 대시보드
 *   맨 아래 한 행이 통째로 시끄러웠다(「너무 많은 걸 보여주려 한다」는 지적).
 *   왜 예전(2026-09-03 이전)처럼 안 만드나: 그때는 묶음 머리와 항목의 들여쓰기가
 *   같아서 어디서 끊기는지 안 보였다. 이번엔 **`divide-y` 로 갈래마다 확실히 선을
 *   긋고**, 묶음 머리(11px 굵게)와 항목(13px)의 크기 차를 벌려 반복하지 않는다.
 *
 * ⚠ 이 카드는 과제 관리 옆(오른쪽 열)에서 `flex-1` 로 남는 세로 공간을 채운다.
 *   그래서 갈래별 항목이 적은 날엔 카드 안쪽에 여백이 남는다 — 없는 걸 있어
 *   보이게 억지로 채우지 않는다. 왼쪽 달력 카드와 세로 길이를 맞추는 자리이지,
 *   내용을 부풀리는 자리가 아니다.
 * ⚠ 0건인 갈래도 그대로 둔다. 사라지면 「저기 보면 된다」는 자리 자체가 없어진다.
 * ⚠ 확정 대기(비목 확정)를 빠뜨리면 안 된다. 확신도 0.70 미만은 코드가 자동 확정을
 *   막게 해 뒀으므로 사람을 기다리는 줄이 반드시 생기는데, 사라지면 쌓이는 걸 아무도 모른다.
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

export function TodoCard({ 갈래들 }: { 갈래들: 큐갈래[] }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">오늘 처리할 것</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {갈래들.reduce((n, g) => n + g.건수, 0)}건
        </span>
      </div>

      <div className="flex-1 divide-y overflow-y-auto">
        {갈래들.map((g) => (
          <div key={g.라벨} className="p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <Link href={g.링크} className="text-[13px] font-semibold hover:underline">
                {g.라벨}
              </Link>
              <span className="text-xs tabular-nums text-muted-foreground">{g.건수}건</span>
            </div>

            {g.건수 === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">걸린 것이 없습니다</p>
            ) : (
              <ul className="space-y-0.5">
                {g.항목.map((it) => (
                  <li key={it.키}>
                    <Link
                      href={g.링크}
                      className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
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
                {g.건수 > g.항목.length && (
                  <li className="px-1 pt-0.5 text-xs text-muted-foreground">
                    외 {g.건수 - g.항목.length}건
                  </li>
                )}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
