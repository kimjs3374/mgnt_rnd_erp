import { ProjectsStageView } from "@/components/projects-stage-view"

export const dynamic = "force-dynamic"

/** 과제사업 > **사업종료**. 수행기간이 끝난 과제. */
export default function ProjectsClosedPage() {
  return <ProjectsStageView 단계="사업종료" />
}
