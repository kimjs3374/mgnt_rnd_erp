import { ProgramsStageView } from "@/components/programs-stage-view"

export const dynamic = "force-dynamic"

/** 지원사업 > **신청완료**. 발표·심사까지 마치고 결과를 기다리는 건. */
export default function ProgramsAppliedPage() {
  return <ProgramsStageView 단계="신청완료" />
}
