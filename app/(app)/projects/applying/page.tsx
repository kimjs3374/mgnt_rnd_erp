import { ProjectsStageView } from "@/components/projects-stage-view"

export const dynamic = "force-dynamic"

/** 과제사업 > **신청중**. 지원을 넣고 결과를 기다리는 건. */
export default function ProjectsApplyingPage() {
  return <ProjectsStageView 단계="신청중" />
}
