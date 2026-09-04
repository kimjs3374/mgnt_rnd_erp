import { AnnouncementsView } from "@/components/announcements-view"
import { RecentJudgmentsFeed } from "@/components/recent-judgments-feed"
import { getRndAnnouncements, 정보성 } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > 공고 탐색. 지원사업(/announcements)과 같은 폼(필터·표)을 쓴다 —
 * components/announcements-explorer.tsx 하나를 공유하고, 이 화면만 다른 것만 prop 으로 넘긴다.
 *
 * **IRIS 가 본체고 NTIS 는 참고다.** IRIS 상세페이지에는 공고문(HWP·HWPX·PDF)이 붙어
 * 있어 받아서 접수기간·자격요건·제출서류까지 판독이 끝난다 — 이 화면이 파는 것이 그거다.
 * NTIS 국가R&D 과제검색 오픈API 는 **이미 수행 중인 과제의 메타정보**라 접수기간도
 * 공고문도 없다(scripts/collect-ntis.mjs 주석). 신청할 수 있는 공고가 아니다.
 *
 * 그래서 한 표에 섞어 필터로 같이 걸러지게 두지 않는다. `referenceRows` 로 따로 넘겨
 * 구분선 아래 항상 흐리게 보여준다 — 지우지는 않는다, 신청 대상인 척하지도 않는다.
 *
 * 기업마당은 지원사업 쪽 화면(/announcements)이 따로 담당한다 — 출처 자체가 다르다.
 */
export default async function ProjectAnnouncementsPage() {
  const { rows, error } = await getRndAnnouncements()

  // NTIS 국가R&D 과제검색(정보성)은 접수기간·공고문이 없는 「이미 수행 중인 과제」 메타정보라
  // 신청 대상이 아니다 — 화면에서 아예 뺀다(2026-09-04, 사용자 요청: "참고 내용은 다 삭제").
  const 공고 = rows.filter((a) => !정보성(a))

  const 미확정 = 공고.filter((r) => r.자격판정 === "확인필요" || r.자격판정 === "요건미확인").length
  const 중복건수 = 공고.filter((r) => r.중복후보).length

  const banner =
    공고.length === 0
      ? "IRIS 공고가 아직 없습니다. scripts/collect-iris.mjs 가 돌면 여기에 채워집니다."
      : `IRIS 로 실제 수집한 공고 ${공고.length}건입니다. 자격판정은 회사 프로필 대조(LLM)가 아직 대부분 실행 전이라 ${미확정}건이 확인필요·요건미확인 상태입니다.` +
        (중복건수 > 0
          ? ` 재공고·연장공고로 보이는 교차 중복 후보 ${중복건수}건이 있습니다 — 자동 병합하지 않고 후보로만 표시합니다.`
          : "")

  return (
    <AnnouncementsView
      title="공고 탐색 (과제사업)"
      description="IRIS 공고문(HWP·PDF)을 받아 판독해 자격 요건·제출 서류를 뽑고 우리 것과 대조한다."
      rows={공고}
      error={error}
      banner={banner}
      showSource
      detailBasePath="/project-announcements"
      emptyHint="IRIS 수집(scripts/collect-iris.mjs)이 돌면 여기에 채워집니다."
      footer={<RecentJudgmentsFeed />}
    />
  )
}
