import { AnnouncementDetail } from "@/components/announcement-detail"

export const dynamic = "force-dynamic"

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <AnnouncementDetail id={id} backHref="/announcements" />
}
