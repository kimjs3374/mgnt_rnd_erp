import { ProjectsStageView } from "@/components/projects-stage-view"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > 과제 관리 > **전체**.
 *
 * 단계로 나누면 「지금 뭘 해야 하나」는 잘 보이는데 **「다 해서 몇 건인가」를 못 본다.**
 * 대장을 통째로 훑거나 기간·유형으로 잘라 보는 일은 단계와 무관하게 생긴다.
 */
export default function ProjectsAllPage() {
  return <ProjectsStageView 단계="전체" />
}
