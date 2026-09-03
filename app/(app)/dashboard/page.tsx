import { PageShell } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { AnnouncementBoard } from "@/components/announcement-board"
import type { 자격판정값 } from "@/components/announcement-board"
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
  getRndAnnouncements,
} from "@/lib/queries"
import { getProgramAnnouncements } from "@/lib/queries-programs"
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
 * 일정(달력) | 과제 관리         ← 언제 / 무엇을 하고 있나
 * 비목 확정 | 챙길 서류 | 점검   ← 내가 눌러야 넘어가는 것
 * ```
 *
 * 2026-09-03 개편(3차)
 *   ① **부제와 요약 줄을 없앴다.** 「오늘 새 공고 50 · 확정 대기 1」이 바로 아래 카드가
 *      더 자세히 말하는 것과 같은 내용이었다.
 *   ② **큐 카드 셋으로 쪼갰고, 0건이어도 카드는 그대로 둔다.** 자리가 고정돼야
 *      「저기 보면 된다」가 생긴다 — 사라지면 격자에 구멍이 나서 고장난 것처럼 보인다.
 *   ③ **과제 관리 카드.** 메뉴를 두 번 눌러 들어가지 않아도 되게. 사이드바의
 *      「과제 관리」(신청중·수행중·사업종료)와 이름·단계를 맞춘다(2026-09-04).
 *   ④ **공고 확인이 자격판정을 함께 보여준다.** `/announcements`·`/project-announcements`
 *      가 이미 쓰는 판정(가능·불가·확인필요·요건미확인, `getProgramAnnouncements`·
 *      `getRndAnnouncements`)을 id 로 붙여서 넘긴다. 새 판정 로직을 만들지 않는다 —
 *      만들면 판정이 두 벌이 되고 한쪽만 고쳐지는 사고가 시연장에서 드러난다(§3.6).
 *
 * ⚠ 확정 대기를 빠뜨리면 안 된다. 확신도 0.70 미만은 코드가 자동 확정을 막게 해 뒀으므로
 *   사람을 기다리는 줄이 반드시 생기는데, 화면에서 사라지면 그게 쌓이는 걸 아무도 모른다.
 */

/** 「오늘」은 서버가 정한다. 심사장 PC 의 시간대를 믿지 않는다. */
function 서울의_오늘() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())
}

export default async function DashboardPage() {
  // 동시에 부른다. 하나가 실패해도 나머지는 그려진다.
  const [ledger, expenses, docs, board, calendar, undated, projects, labels, program, rnd] =
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
      // 자격판정만 쓰려고 부른다 — 공고 탐색과 같은 함수, 같은 값이다.
      getProgramAnnouncements(),
      getRndAnnouncements(),
    ])

  const today = 서울의_오늘()

  const 확정대기 = expenses.rows.filter((e) => e.상태 === "검토대기")
  const 점검 = ledger.rows.filter((r) => r.미처리점검 > 0)
  const 미확보서류 = docs.rows.filter((d) => ["만료", "없음"].includes(d.상태))

  // id → 자격판정. 두 출처를 합쳐도 id 는 announcements 테이블 한 곳에서 오므로 안 섞인다.
  // 판정을 못 가져왔다고 카드 전체를 죽이지 않는다 — 배지가 안 뜰 뿐이다.
  const 판정: Record<number, 자격판정값 | undefined> = {}
  for (const r of [...program.rows, ...rnd.rows]) 판정[r.id] = r.자격판정

  const errors = [ledger, expenses, docs, board, calendar, undated, projects]
    .map((r, i) => ({
      e: r.error,
      what: ["대장", "집행", "서류함", "공고", "일정", "날짜 미정", "과제 관리"][i],
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
        판정={판정}
        undated={undated.rows}
        today={today}
        error={board.error}
      />

      {/* ② 언제 / 무엇을 하고 있나 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CalendarBoard rows={calendar.rows} today={today} error={calendar.error} />
        <ProjectBoard rows={projects.rows} today={today} error={projects.error} />
      </div>

      {/* ③ 내가 눌러야 넘어가는 것 — 0건이어도 카드는 그대로 있고 안이 조용해진다.
          items-start 가 없으면 1줄짜리 카드가 옆 카드 높이만큼 늘어난다. */}
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
          라벨="챙길 서류"
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
