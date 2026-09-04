import { ProgramFiles } from "@/components/program-files"
import { getProgramFiles } from "@/lib/queries-program-files"

export const dynamic = "force-dynamic"

/**
 * 지원사업 > **서류함**.
 *
 * 계상 증빙·집행 증빙·정산 서류가 각각 다른 표에 들어간다. 붙는 자리가 달라서 그렇고
 * 그건 그대로 둔다 — 대신 **한 눈에 보고 한 번에 받는 자리**를 여기 하나 만든다
 * (2026-09-04 사용자 지시).
 *
 * 업체 서류(사업자등록증·통장사본)와 회사 서류함은 여기 없다. 그건 사업에 붙는 게 아니라
 * 업체·회사에 붙고, 여러 사업이 같은 것을 쓴다(회사 > 업체 · 회사 > 서류함).
 */
export default async function ProgramFilesPage() {
  const { 파일, error } = await getProgramFiles()

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">서류함</h1>
        <p className="text-sm text-muted-foreground">
          사업마다 올린 서류를 모아 본다. 기간을 정해 거르고, 사업별 폴더로 묶어 한 번에 받는다.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          서류 목록을 읽지 못했다: {error}
        </p>
      ) : (
        <ProgramFiles 파일={파일} />
      )}
    </div>
  )
}
