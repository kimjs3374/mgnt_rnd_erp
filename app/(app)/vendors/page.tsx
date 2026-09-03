import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { VendorsPanel } from "@/components/vendors-panel"
import {
  getVendorStatus,
  getVendorDetails,
  getVendorDocuments,
  getUnregisteredVendors,
} from "@/lib/queries-vendors"
import { getCurrentUser } from "@/lib/current-user"
import { won } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 업체(거래처) — 사업자등록증·통장사본을 받아 두는 자리.
 *
 * 왜 「회사」 그룹에 있나: 서류함(우리가 내는 서류) · 규정 문서함(받는 규정)과 같은 층이다.
 * 셋 다 **과제보다 위**에 있고 여러 과제가 같은 것을 쓴다. 업체 서류도 그렇다 —
 * 한 번 받은 등록증을 12개 과제에서 같이 쓴다. 과제 안에 두면 건마다 다시 받게 된다.
 *
 * **더미를 넣지 않았다**(2026-09-03 사용자 결정). 그래서 첫 화면은 빈 표인데,
 * 집행 건에 있는 거래처를 후보로 띄워 「어디서 시작할지」를 화면이 말한다.
 */
export default async function VendorsPage() {
  const [status, details, docs, 미등록, who] = await Promise.all([
    getVendorStatus(),
    getVendorDetails(),
    getVendorDocuments(),
    getUnregisteredVendors(),
    getCurrentUser(),
  ])

  const 업체 = status.rows
  const 등록증없음 = 업체.filter((v) => v.등록증_건수 === 0).length
  const 통장없음 = 업체.filter((v) => v.통장사본_건수 === 0).length
  const 집행액 = 업체.reduce((s, v) => s + Number(v.집행액 ?? 0), 0)

  return (
    <PageShell
      title="업체"
      description="거래처 대장과 업체에서 받아 두는 서류(사업자등록증 · 통장사본). 과제가 아니라 업체에 붙는 서류라 한 번 받으면 모든 과제에서 쓴다."
    >
      {status.error && <DbError what="업체" error={status.error} />}
      {details.error && <DbError what="업체 상세" error={details.error} />}
      {docs.error && <DbError what="업체 서류" error={docs.error} />}
      {미등록.error && <DbError what="집행 거래처" error={미등록.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="등록 업체" value={업체.length} sub={`집행 합계 ${won(집행액)}`} />
        <Stat
          label="사업자등록증 미확보"
          value={등록증없음}
          sub={업체.length ? `${업체.length}곳 중` : "업체를 먼저 등록한다"}
          tone={등록증없음 > 0 ? "warn" : "default"}
        />
        <Stat
          label="통장사본 미확보"
          value={통장없음}
          sub={업체.length ? `${업체.length}곳 중` : "업체를 먼저 등록한다"}
          tone={통장없음 > 0 ? "warn" : "default"}
        />
        <Stat
          label="대장에 없는 거래처"
          value={미등록.rows.length}
          sub="집행 건에는 있다"
          tone={미등록.rows.length > 0 ? "warn" : "default"}
        />
      </div>

      <VendorsPanel
        업체={업체}
        상세={details.rows}
        서류={docs.rows}
        미등록={미등록.rows}
        로그인={who.인증}
      />

      <p className="text-xs text-muted-foreground">
        업체는 <span className="text-foreground">사업자번호</span>로 집행 건과 잇는다 — 증빙마다
        업체명 표기가 달라서(「주식회사 천보신소재(Chunbo …)」 대 「천보신소재」) 이름으로 묶으면 같은
        업체가 둘로 갈린다. 파일은 비공개 저장소에 들어가고 내려받을 때만 60초 서명 주소가 생긴다.
        계좌번호는 내부 공유 화면이라 가리지 않는다.
      </p>
    </PageShell>
  )
}
