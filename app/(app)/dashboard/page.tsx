import Link from "next/link"
import { PageShell } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import { AnnouncementBoard } from "@/components/announcement-board"
import { CalendarBoard } from "@/components/calendar-board"
import {
  getLedger,
  getExpenses,
  getDocuments,
  getAnnouncementBoard,
  getCalendar,
  getCalendarUndated,
} from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 대시보드 — 큐 네 개.
 *
 * 올릴지 말지의 기준은 하나다: **행동이 필요한가.**
 *   보고 나서 할 일이 생기면 올리고, 그냥 알고 넘어가는 숫자면 안 올린다.
 *   그래서 예산 소진율 같은 상태 숫자는 뺐다(2026-09-03). 62% 를 봐도 할 일이 없다.
 *
 *   ① 새로 올라온 공고  — 놓친 기회가 있나
 *   ② 곧 닥치는 일정    — 언제까지 뭘 해야 하나
 *   ③ 손봐야 할 것      — 지금 틀려 있거나 내 확정을 기다리는 게 있나
 *
 * ⚠ 아무 일 없으면 조용해야 한다. **항상 켜져 있는 경고는 경고가 아니다.**
 *   각 큐는 걸리는 게 없으면 카드째 사라진다. 회색으로 「0건」을 띄우지 않는다.
 *   매일 여는 화면이라, 늘 떠 있으면 며칠 안에 눈이 그 자리를 건너뛴다.
 */

/** 「오늘」은 서버가 정한다. 심사장 PC 의 시간대를 믿지 않는다. */
function 서울의_오늘() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())
}

export default async function DashboardPage() {
  // 여섯 갈래를 동시에 부른다. 하나가 실패해도 나머지는 그려진다.
  const [ledger, expenses, docs, board, calendar, undated] = await Promise.all([
    getLedger(),
    getExpenses(),
    getDocuments(),
    getAnnouncementBoard(),
    getCalendar(),
    getCalendarUndated(),
  ])

  const today = 서울의_오늘()

  const 신규공고 = board.rows.filter((r) => r.신규).length
  const 확정대기 = expenses.rows.filter((e) => e.상태 === "검토대기")
  const 점검 = ledger.rows.filter((r) => r.미처리점검 > 0)
  const 미확보서류 = docs.rows.filter((d) => ["만료", "없음"].includes(d.상태))

  // 이번 주(일~토) 안에 걸리는 일정 수 — 한 줄 요약에만 쓴다.
  const 이번주 = calendar.rows.filter(
    (r) => r.d_day != null && r.d_day >= 0 && r.d_day <= 7,
  ).length

  const 손볼것 = 확정대기.length + 점검.length + 미확보서류.length

  const errors = [ledger, expenses, docs, board, calendar, undated]
    .map((r, i) => ({
      e: r.error,
      what: ["대장", "집행", "서류함", "공고", "일정", "날짜 미정"][i],
    }))
    .filter((x) => x.e)

  // 카드 다섯 개를 문장 하나로 압축했다. 지울 정보는 없고, 높이만 줄인다.
  const 요약 = [
    신규공고 > 0 && `오늘 새 공고 ${신규공고}`,
    이번주 > 0 && `7일 내 일정 ${이번주}`,
    확정대기.length > 0 && `확정 대기 ${확정대기.length}`,
    점검.length > 0 && `점검 ${점검.length}`,
  ].filter(Boolean) as string[]

  return (
    <PageShell title="대시보드" description="오늘 손대야 할 것만 모았다.">
      {errors.map((x) => (
        <DbError key={x.what} what={x.what} error={x.e!} />
      ))}

      <p className="-mt-1 text-[13px] text-muted-foreground">
        {요약.length > 0 ? (
          요약.join(" · ")
        ) : (
          <span>지금 손댈 것이 없습니다.</span>
        )}
      </p>

      {/* ② 곧 닥치는 일정 */}
      <CalendarBoard
        rows={calendar.rows}
        undated={undated.rows}
        today={today}
        error={calendar.error}
      />

      {/* ① 새로 올라온 공고 — 생애주기의 입구 */}
      <AnnouncementBoard rows={board.rows} />

      {/* ③ 손봐야 할 것 — 걸리는 게 없으면 이 카드는 통째로 사라진다 */}
      {손볼것 > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">손봐야 할 것</h2>
          </div>
          <div className="divide-y">
            <Queue
              title="확정 대기"
              hint="AI 가 제안했지만 사람이 눌러야 넘어간다"
              href="/expenses"
              items={확정대기.slice(0, 5).map((e) => ({
                key: String(e.id),
                left: e.거래처 ?? "거래처 미상",
                right: e.비목_대분류 ?? "비목 미지정",
              }))}
              total={확정대기.length}
            />
            <Queue
              title="제출 전 점검"
              hint="누락 · 날짜오류 · 금액 불일치"
              href="/programs"
              items={점검.slice(0, 5).map((r) => ({
                key: String(r.id),
                left: r.사업명,
                right: `${r.미처리점검}건`,
              }))}
              total={점검.length}
            />
            <Queue
              title="서류"
              hint="만료됐거나 아직 없는 것"
              href="/documents"
              items={미확보서류.slice(0, 5).map((d) => ({
                key: d.코드,
                left: d.이름,
                right: <StatusBadge value={d.상태} />,
              }))}
              total={미확보서류.length}
            />
          </div>
        </div>
      )}
    </PageShell>
  )
}

/** 큐 한 덩어리. 비어 있으면 아예 그리지 않는다 — 조용해야 눈에 띈다. */
function Queue({
  title,
  hint,
  href,
  items,
  total,
}: {
  title: string
  hint: string
  href: string
  items: { key: string; left: string; right: React.ReactNode }[]
  total: number
}) {
  if (total === 0) return null

  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-[13px] font-medium">{title}</h3>
        <span className="tabular-nums text-xs text-muted-foreground">{total}</span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
        <Link href={href} className="ml-auto shrink-0 text-xs text-primary hover:underline">
          전체
        </Link>
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{it.left}</span>
            <span className="shrink-0 text-muted-foreground">{it.right}</span>
          </li>
        ))}
        {total > items.length && (
          <li className="text-xs text-muted-foreground">외 {total - items.length}건</li>
        )}
      </ul>
    </div>
  )
}
