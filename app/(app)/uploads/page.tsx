import { FileClock, ShieldQuestion, Users } from "lucide-react"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { UploadLogTable } from "@/components/upload-log-table"
import { getUploadLog } from "@/lib/queries-upload-log"

export const dynamic = "force-dynamic"

/**
 * 서류 올린 기록 — **누가(아이디 기준) 언제 올렸나.** (2026-09-04 사용자 지시)
 *
 * 왜 한 화면인가: 서류가 붙는 자리가 다섯이다(과제 증빙 · 과제 정산 · 회사 서류함 ·
 * 규정 문서함 · 업체 서류). 「이 파일 누가 올렸지」를 다섯 화면 뒤져서 찾게 하면
 * 아무도 안 찾는다. 정산 때 실제로 필요한 질문이라 한 자리에 모은다.
 *
 * 왜 「회사」 층에 있나: 과제 하나에 매인 것이 아니라 **전 과제를 가로지른다.**
 */
export default async function UploadsPage() {
  const 기록 = await getUploadLog()
  const rows = 기록.rows

  const 확인됨 = rows.filter((r) => r.아이디).length
  const 사람수 = new Set(rows.map((r) => r.아이디).filter(Boolean)).size

  return (
    <PageShell
      title="서류 올린 기록"
      description="지원사업·과제사업·업체 서류를 누가(로그인 아이디) 언제 올렸는지 한자리에서 봅니다. 보는 화면이라 여기서 파일을 고치거나 지우지 않습니다."
    >
      {기록.error && <DbError what="올린 기록" error={기록.error} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={FileClock} label="올린 서류" value={rows.length} sub="다섯 자리를 합친 수" />
        <Stat icon={Users} label="올린 사람" value={사람수} sub="로그인 아이디 기준" />
        <Stat
          icon={ShieldQuestion}
          label="올린 사람 확인 안 됨"
          value={rows.length - 확인됨}
          sub={
            rows.length - 확인됨 > 0
              ? "로그인 붙기 전에 올라온 건"
              : "전부 누가 올렸는지 남아 있다"
          }
          tone={rows.length - 확인됨 > 0 ? "warn" : "default"}
        />
      </div>

      <UploadLogTable 기록={rows} />

      <p className="text-xs text-muted-foreground">
        아이디는 올릴 때 적힌 이름이 아니라{" "}
        <span className="text-foreground">그때 로그인한 계정 번호로 지금 다시 찾은 값</span>입니다 —
        사람이 이름을 바꿔도 옛 기록이 딴사람이 되지 않습니다. 로그인 확인이 안 된 기록에는 아이디를
        붙이지 않습니다. 없는 사실을 적으면 기록이 아니라 소설이 됩니다.
      </p>
    </PageShell>
  )
}
