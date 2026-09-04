import { ProjectsStageView } from "@/components/projects-stage-view"

export const dynamic = "force-dynamic"

/** 과제사업 > **미선정**. 신청했지만 떨어진 건 — 신청중·신청완료 화면에는 안 보인다. */
export default function ProjectsRejectedPage() {
  return <ProjectsStageView 단계="미선정" />
}
