import { AnnouncementDetail } from "@/components/announcement-detail"
import { ApplyPanel } from "@/components/apply-panel"
import { getAnnouncementBasics, getApplicationsByAnnouncement } from "@/lib/queries-project"

export const dynamic = "force-dynamic"

export default async function ProjectAnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const 공고_id = Number(id)

  const [ann, apps] = await Promise.all([
    getAnnouncementBasics(공고_id),
    getApplicationsByAnnouncement(공고_id),
  ])
  const a = ann.rows[0]

  return (
    <AnnouncementDetail
      id={id}
      backHref="/project-announcements"
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
