import { ProgramsStageView } from "@/components/programs-stage-view"

export const dynamic = "force-dynamic"

/** 지원사업 > **신청중**. 지원을 넣고 결과를 기다리는 건. */
export default function ProgramsApplyingPage() {
  return <ProgramsStageView 단계="신청중" />
}
