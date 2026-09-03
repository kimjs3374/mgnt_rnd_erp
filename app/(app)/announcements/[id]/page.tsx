import { AnnouncementDetail } from "@/components/announcement-detail"
import { ApplyPanel } from "@/components/apply-panel"
import { getAnnouncementBasics, getApplicationsByAnnouncement } from "@/lib/queries-project"

export const dynamic = "force-dynamic"

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const 공고_id = Number(id)

  // 지원 등록·선정 처리는 공고 화면에서 시작한다 — 일이 거기서 시작하기 때문이다.
  // 등록하면 app.projects 에 한 줄이 생기고 그게 곧 지원사업 대장의 한 줄이다.
  const [ann, apps] = await Promise.all([
    getAnnouncementBasics(공고_id),
    getApplicationsByAnnouncement(공고_id),
  ])
  const a = ann.rows[0]

  return (
    <AnnouncementDetail
      id={id}
      backHref="/announcements"
      footer={
        <ApplyPanel
          공고_id={공고_id}
          사업명={a?.사업명 ?? null}
          접수종료={a?.접수종료 ?? null}
          지원행목록={apps.rows}
        />
      }
    />
  )
}
