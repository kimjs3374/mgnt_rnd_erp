import { ProjectsStageView } from "@/components/projects-stage-view"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > **수행중**. 선정되어 협약기간 안에 있는 과제.
 *
 * 경로를 `/projects` 그대로 둔다 — 과제 상세(`/projects/[id]`)의 부모이고,
 * 이미 여러 화면·브레드크럼·테스트가 이 주소를 가리키고 있다.
 * 나머지 두 단계는 `/projects/applying` · `/projects/closed` 다(정적 조각이라 `[id]` 를 이긴다).
 */
export default function ProjectsRunningPage() {
  return <ProjectsStageView 단계="수행중" />
}
