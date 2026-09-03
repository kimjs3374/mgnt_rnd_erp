import { ProgramsStageView } from "@/components/programs-stage-view"

export const dynamic = "force-dynamic"

/**
 * 지원사업 > **수행중**. 선정되어 수행기간 안에 있는 사업.
 *
 * 경로가 `/programs/executing`인 이유 — 과제사업은 `/projects`(맨몸)가 이미 비어 있어서
 * 수행중을 거기 뒀지만, 지원사업은 `/programs`(맨몸)가 이미 「전체」로 쓰이고 있어서
 * 수행중은 새 경로가 필요했다.
 */
export default function ProgramsExecutingPage() {
  return <ProgramsStageView 단계="수행중" />
}
