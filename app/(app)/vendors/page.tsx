import { Building2, FileWarning, Landmark, TriangleAlert } from "lucide-react"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { VendorsPanel } from "@/components/vendors-panel"
import {
  getVendorStatus,
  getVendorDetails,
  getVendorDocuments,
  getUnregisteredVendors,
  getVendorExpenses,
} from "@/lib/queries-vendors"
import { won, getCategories } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 업체(거래처) — 사업자등록증·통장사본을 받아 두는 자리.
 *
 * 왜 「과제사업」 그룹, 과제사업 서류함 옆에 있나(2026-09-04 사용자 지시): 정산 때
 * 서류를 챙기는 사람이 **과제 서류와 업체 서류를 같이 찾는다.** 두 그룹으로 갈라 두면
 * 매번 「회사」 탭까지 갔다 온다.
 *
 * ⚠ 그렇다고 **서류함 목록에 섞지는 않는다**(`lib/queries-program-files.ts`).
 *   업체 서류는 사업이 아니라 **업체**에 붙고, 한 번 받은 등록증을 12개 과제가 같이 쓴다.
 *   한 사업 폴더에 넣는 순간 「이 사업 서류」라는 말이 거짓이 된다.
 *   메뉴에서 이웃하게 두되 **자기 화면은 따로** 가진다.
 *
 * **더미를 넣지 않았다**(2026-09-03 사용자 결정). 그래서 첫 화면은 빈 표인데,
 * 집행 건에 있는 거래처를 후보로 띄워 「어디서 시작할지」를 화면이 말한다.
 */
export default async function VendorsPage() {
  // 로그인 기능이 아직 없다(2026-09-03) — 화면이 그걸 전제하지 않는다.
  // 업로더 기록은 서버 액션이 세션이 있을 때만 넣는다. 로그인이 붙으면 화면도 저절로 이름을 보인다.
  const [status, details, docs, 미등록, 집행내역, 비목] = await Promise.all([
    getVendorStatus(),
    getVendorDetails(),
    getVendorDocuments(),
    getUnregisteredVendors(),
    getVendorExpenses(),
    getCategories(),
  ])

  const 업체 = status.rows
  const 등록증없음 = 업체.filter((v) => v.등록증_건수 === 0).length
  const 통장없음 = 업체.filter((v) => v.통장사본_건수 === 0).length
  const 집행액 = 업체.reduce((s, v) => s + Number(v.집행액 ?? 0), 0)

  return (
    <PageShell
      title="업체 서류"
      description="거래처 대장과 업체에서 받아 두는 서류(사업자등록증 · 통장사본). 표에서 「등록 ⤓」 을 누르면 그 서류를 바로 받고, 「구매내역」 을 누르면 그 업체와의 거래 내역을 봅니다. 과제가 아니라 업체에 붙는 서류라 한 번 받으면 모든 과제에서 씁니다."
    >
      {status.error && <DbError what="업체" error={status.error} />}
      {details.error && <DbError what="업체 상세" error={details.error} />}
      {docs.error && <DbError what="업체 서류" error={docs.error} />}
      {미등록.error && <DbError what="집행 거래처" error={미등록.error} />}
      {집행내역.error && <DbError what="업체 집행 내역" error={집행내역.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Building2}
          label="등록 업체"
          value={업체.length}
          sub={`집행 합계 ${won(집행액)}`}
        />
        <Stat
          icon={FileWarning}
          label="사업자등록증 미등록"
          value={등록증없음}
          sub={업체.length ? `${업체.length}곳 중` : "업체를 먼저 등록한다"}
          tone={등록증없음 > 0 ? "warn" : "default"}
        />
        <Stat
          icon={Landmark}
          label="통장사본 미등록"
          value={통장없음}
          sub={업체.length ? `${업체.length}곳 중` : "업체를 먼저 등록한다"}
          tone={통장없음 > 0 ? "warn" : "default"}
        />
        <Stat
          icon={TriangleAlert}
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
        집행내역={집행내역.rows}
        비목이름={Object.fromEntries(비목.rows.map((c) => [c.코드, c.이름]))}
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
