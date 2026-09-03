import { PageShell } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { AnnouncementBoard } from "@/components/announcement-board"
import { CalendarBoard } from "@/components/calendar-board"
import { ProjectBoard } from "@/components/project-board"
import { QueueCard } from "@/components/queue-card"
import {
  getLedger,
  getExpenses,
  getDocuments,
  getAnnouncementBoard,
  getCalendar,
  getCalendarUndated,
  getProjects,
} from "@/lib/queries"
import { getLabels, categoryLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

/**
 * 대시보드 — 카드를 성격별로 쪼갠 판.
 *
 * 올릴지 말지의 기준은 하나다: **행동이 필요한가.**
 *   보고 나서 할 일이 생기면 올리고, 그냥 알고 넘어가는 숫자면 안 올린다.
 *
 * ```
 * 공고 확인                     ← 새로 온 기회
 * 일정(달력) | 수행 과제·사업    ← 언제 / 무엇을 하고 있나
 * 비목 확정 | 빠진 서류 | 점검   ← 내가 눌러야 넘어가는 것
 * ```
 *
 * 2026-09-03 개편(2차) — 「카드 둘」에서 이 판으로 갈아엎었다.
 *   ① **부제와 요약 줄을 없앴다.** 「오늘 새 공고 50 · 확정 대기 1」이 바로 아래 카드가
 *      더 자세히 말하는 것과 같은 내용이었다. 같은 걸 두 번 말하면 둘 다 안 읽힌다.
 *   ② **「기다리는 일」 한 카드를 큐 카드 셋으로 쪼갰다.** 한 카드 안에서는 묶음 머리와
 *      항목의 들여쓰기가 같아 어디서 끊기는지 안 보였다. 카드 제목이 곧 묶음 이름이 된다.
 *   ③ **수행 과제·사업 카드를 새로 넣었다.** 「내가 무슨 사업을 하고 있더라」를 보려고
 *      메뉴를 두 번 눌러 들어가는 게 이상했다.
 *   ④ **달력이 절반 폭으로 줄었다.** 칸에 제목 대신 건수 배지만 찍는다.
 *
 * ⚠ 아무 일 없으면 조용해야 한다. **항상 켜져 있는 경고는 경고가 아니다.**
 *   0건인 큐 카드는 아예 안 그린다. 회색으로 「0건」을 띄우지 않는다.
 * ⚠ 확정 대기를 빠뜨리면 안 된다. 확신도 0.70 미만은 코드가 자동 확정을 막게 해 뒀으므로
 *   사람을 기다리는 줄이 반드시 생기는데, 화면에서 사라지면 그게 쌓이는 걸 아무도 모른다.
 */

/** 「오늘」은 서버가 정한다. 심사장 PC 의 시간대를 믿지 않는다. */
function 서울의_오늘() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())
}

export default async function DashboardPage() {
  // 동시에 부른다. 하나가 실패해도 나머지는 그려진다.
  const [ledger, expenses, docs, board, calendar, undated, projects, labels] =
    await Promise.all([
      getLedger(),
      getExpenses(),
      getDocuments(),
      getAnnouncementBoard(),
      getCalendar(),
      getCalendarUndated(),
      getProjects(),
      // 비목은 DB 에 FACILITY 같은 코드로 들어 있다. 화면에 코드가 보이면 사용자가 읽을 수 없다.
      getLabels(),
    ])

  const today = 서울의_오늘()

  const 확정대기 = expenses.rows.filter((e) => e.상태 === "검토대기")
  const 점검 = ledger.rows.filter((r) => r.미처리점검 > 0)
  const 미확보서류 = docs.rows.filter((d) => ["만료", "없음"].includes(d.상태))

  const errors = [ledger, expenses, docs, board, calendar, undated, projects]
    .map((r, i) => ({
      e: r.error,
      what: ["대장", "집행", "서류함", "공고", "일정", "날짜 미정", "수행 과제"][i],
    }))
    .filter((x) => x.e)

  return (
    <PageShell title="대시보드">
      {errors.map((x) => (
        <DbError key={x.what} what={x.what} error={x.e!} />
      ))}

      {/* ① 새로 온 기회 — 첫 화면의 첫 줄이라 이미 마감된 공고는 들어오지 않는다 */}
      <AnnouncementBoard
        rows={board.rows}
        undated={undated.rows}
        today={today}
        최대={5}
        error={board.error}
      />

      {/* ② 언제 / 무엇을 하고 있나 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CalendarBoard rows={calendar.rows} today={today} error={calendar.error} />
        <ProjectBoard rows={projects.rows} 최대={5} error={projects.error} />
      </div>

      {/* ③ 내가 눌러야 넘어가는 것 — 0건인 카드는 스스로 안 그린다.
          items-start 가 없으면 1줄짜리 카드가 옆 카드 높이만큼 늘어나 빈 상자로 보인다. */}
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QueueCard
          라벨="비목 확정"
          링크="/expenses"
          건수={확정대기.length}
          항목={확정대기.slice(0, 4).map((e) => ({
            키: `e${e.id}`,
            이름: e.거래처 ?? "거래처 미상",
            꼬리: e.비목_대분류
              ? categoryLabel(labels, e.비목_대분류, e.비목_세부항목).main
              : "비목 미지정",
          }))}
        />
        <QueueCard
          라벨="빠진 서류"
          링크="/documents"
          건수={미확보서류.length}
          항목={미확보서류.slice(0, 4).map((d) => ({
            키: `d${d.코드}`,
            이름: d.이름,
            꼬리: d.상태,
            배지: true,
          }))}
        />
        <QueueCard
          라벨="제출 전 점검"
          링크="/programs"
          건수={점검.length}
          항목={점검.slice(0, 4).map((r) => ({
            키: `p${r.id}`,
            이름: r.사업명,
            꼬리: `${r.미처리점검}건`,
          }))}
        />
      </div>
    </PageShell>
  )
}
