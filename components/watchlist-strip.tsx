import Link from "next/link"
import { Star } from "lucide-react"
import type { WatchRow } from "@/lib/queries-budgeting"
import { 단계이름 } from "@/lib/queries-budgeting"

/**
 * 관심 공고 — 계상 화면 **맨 위**에 둔다.
 *
 * 계상은 흐름의 끝이고 관심 공고는 처음이다. 「지금 챙겨야 할 것」을 한 화면에서 보려면
 * 앞 단계가 위에 있어야 한다 — **마감이 지나가는 공고는 계상할 과제보다 급하다.**
 * 그래서 마감이 가까운 순으로 세우고, 지원 등록을 했는지까지 한 줄에 같이 보여준다.
 *
 * ⚠ 과제사업(IRIS) 공고만 거르지 않는다. 관심은 사람이 직접 표시한 것이라 여기서 걸러 버리면
 *   표시해 둔 것이 사라진 것처럼 보인다. 대신 어느 쪽 공고인지(출처)를 같이 적는다.
 *
 * 관심 표시를 켜고 끄는 일은 여기서 하지 않는다 — 공고 화면(권태호 담당)이 이미 한다.
 * 같은 동작을 두 곳에 두면 한쪽만 고쳐진다.
 */

function DDay({ 남은일 }: { 남은일: number | null }) {
  if (남은일 == null) return <span className="text-[12.7px] text-muted-foreground">상시·미정</span>
  if (남은일 < 0)
    return <span className="text-[12.7px] text-muted-foreground">마감 {-남은일}일 지남</span>
  const 급함 = 남은일 <= 7
  return (
    <span
      className={
        "inline-flex h-5 items-center rounded-4xl px-2 text-[12.7px] font-medium tabular-nums " +
        (급함 ? "bg-[var(--warning)] text-[var(--warning-fg)]" : "bg-secondary text-foreground")
      }
    >
      D-{남은일}
    </span>
  )
}

export function WatchlistStrip({ rows }: { rows: WatchRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-1 flex items-center gap-2 text-[14.3px] font-medium">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--warning)] text-[var(--warning-fg)]">
            <Star className="size-3" />
          </span>
          관심 공고
        </div>
        <p className="text-[13.8px] text-muted-foreground">
          아직 관심 표시한 공고가 없습니다. 공고 탐색에서 별을 누르면 여기 먼저 뜹니다 — 마감이
          가까운 것부터 세우고, 지원 등록을 했는지까지 같이 보여줍니다.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="flex items-center gap-2 text-[14.3px] font-medium">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--warning)] text-[var(--warning-fg)]">
            <Star className="size-3" />
          </span>
          관심 공고
        </span>
        <span className="text-[12.7px] text-muted-foreground">
          {rows.length}건 · 마감이 가까운 순 · 계상보다 앞 단계라 위에 둔다
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li
            key={r.공고_id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-[13.8px]"
          >
            <DDay 남은일={r.남은일} />
            <Link href={r.상세경로} className="font-medium underline-offset-2 hover:underline">
              {r.사업명}
            </Link>
            <span className="text-[12.7px] text-muted-foreground">
              {r.소관부처 ?? "기관 미상"} · {r.출처}
              {r.접수종료 ? ` · ~${r.접수종료}` : ""}
            </span>

            {/* 지원했는지 → 선정됐는지 → 계상 어디까지. 한 줄에서 다음 할 일이 보여야 한다. */}
            {r.지원과제 == null ? (
              <span className="ml-auto text-[12.7px] text-[var(--warning-fg)]">
                아직 지원 등록 안 함 —{" "}
                <Link href={r.상세경로} className="underline underline-offset-2">
                  공고에서 [지원 등록]
                </Link>
              </span>
            ) : r.지원과제.단계 == null ? (
              <span className="ml-auto text-[12.7px] text-muted-foreground">
                지원 등록됨 · {r.지원과제.선정결과 ?? r.지원과제.상태} — 선정 결과를 기다리는 중
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-2 text-[12.7px] text-muted-foreground">
                선정 · {단계이름[r.지원과제.단계]}
                {/* 한 공고로 여러 건을 넣었으면 숨기지 않는다 — 링크가 가리키는 건 그중 하나뿐이다. */}
                {r.지원건수 > 1 && <span>외 {r.지원건수 - 1}건</span>}
                <Link
                  href={`/projects/${r.지원과제.id}/budget`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  계상으로
                </Link>
              </span>
            )}

            {r.메모 && (
              <span className="basis-full text-[12.1px] text-muted-foreground">메모: {r.메모}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
