import { ProgramsStageView } from "@/components/programs-stage-view"

export const dynamic = "force-dynamic"

/** 지원사업 > **사업종료**. 수행기간이 끝난 사업. */
export default function ProgramsClosedPage() {
  return <ProgramsStageView 단계="사업종료" />
}
