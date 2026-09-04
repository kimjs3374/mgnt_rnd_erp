import { ProgramFiles } from "@/components/program-files"
import { getProgramFiles } from "@/lib/queries-program-files"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > **과제사업 서류함**.
 *
 * 지원사업 서류함(`app/(app)/programs/files/page.tsx`)과 완전히 같은 화면·조회다 —
 * `getProgramFiles(true)`로 국가 R&D 과제까지만 세는 것만 다르다(2026-09-04 사용자
 * 지시: "지원사업의 지원사업 서류함처럼 과제사업의 과제관리 아래에 과제사업 서류함
 * 탭 생성"). 계상 증빙·집행 증빙·정산 서류가 각각 다른 표에 들어가는 건 그대로 두고,
 * 보는 자리만 하나로 모은다.
 *
 * 업체 서류·회사 서류함·규정 문서함은 여기 없다 — 사업에 붙는 게 아니라 업체·회사에 붙는다.
 */
export default async function ProjectFilesPage() {
  const { 파일, 보류, error } = await getProgramFiles("project")

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">과제사업 서류함</h1>
        <p className="text-sm text-muted-foreground">
          과제마다 올린 서류를 모아 본다. 기간을 정해 거르고, 과제별 폴더로 묶어 한 번에 받는다.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          서류 목록을 읽지 못했다: {error}
        </p>
      ) : (
        <ProgramFiles 파일={파일} 보류={보류} 스코프="project" />
      )}
    </div>
  )
}
