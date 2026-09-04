import Link from "next/link"
import { ProgramFiles } from "@/components/program-files"
import { VendorsPanel } from "@/components/vendors-panel"
import { getProgramFiles } from "@/lib/queries-program-files"
import {
  getVendorStatus,
  getVendorDetails,
  getVendorDocuments,
  getUnregisteredVendors,
  getVendorExpenses,
} from "@/lib/queries-vendors"
import { getCategories } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > **과제사업 서류함**. 탭 둘 — 「과제 서류」와 「업체 서류」.
 *
 * 지원사업 서류함(`app/(app)/programs/files/page.tsx`)과 같은 화면·조회다 —
 * `getProgramFiles("project")` 로 국가 R&D 과제까지만 세는 것만 다르다.
 *
 * ⚠ **업체 서류를 과제 서류 목록에 섞지 않는다**(2026-09-04 사용자 지시로 여기 넣되).
 *   업체 서류는 사업이 아니라 **업체**에 붙는다 — 한 번 받은 사업자등록증을 12개 과제가
 *   같이 쓴다. 한 사업 폴더에 넣는 순간 「이 사업 서류」라는 말이 거짓이 되고,
 *   과제별 zip 에도 같은 파일이 12번 들어간다. 그래서 **같은 화면 · 다른 탭**이다.
 *
 * 탭을 클라이언트 상태가 아니라 **주소(`?tab=vendors`)** 로 잡는다 — 새로고침해도 그 자리고,
 * 「업체 서류 보라」고 주소를 건넬 수 있다. 서버에서 필요한 쪽만 읽어 온다.
 */
export default async function ProjectFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const 업체탭 = tab === "vendors"

  const 서류함 = 업체탭 ? null : await getProgramFiles("project")
  const 업체 = 업체탭
    ? await Promise.all([
        getVendorStatus(),
        getVendorDetails(),
        getVendorDocuments(),
        getUnregisteredVendors(),
        getVendorExpenses(),
        getCategories(),
      ])
    : null

  const 탭 = [
    { 이름: "과제 서류", 주소: "/projects/files", 켜짐: !업체탭 },
    { 이름: "업체 서류", 주소: "/projects/files?tab=vendors", 켜짐: 업체탭 },
  ]

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">과제사업 서류함</h1>
        <p className="text-sm text-muted-foreground">
          {업체탭
            ? "거래처에서 받아 두는 서류(사업자등록증 · 통장사본). 「등록 ⤓」 을 누르면 바로 받고, 「구매내역」 을 누르면 그 업체와의 거래 내역을 본다."
            : "과제마다 올린 서류를 모아 본다. 기간을 정해 거르고, 과제별 폴더로 묶어 한 번에 받는다."}
        </p>
      </div>

      {/* 탭 — 주소가 곧 상태다. 눌러서 온 자리를 그대로 다시 열 수 있다. */}
      <div className="flex gap-1 border-b">
        {탭.map((t) => (
          <Link
            key={t.주소}
            href={t.주소}
            aria-current={t.켜짐 ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${
              t.켜짐
                ? "border-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.이름}
          </Link>
        ))}
      </div>

      {업체탭 && 업체 ? (
        <VendorsPanel
          업체={업체[0].rows}
          상세={업체[1].rows}
          서류={업체[2].rows}
          미등록={업체[3].rows}
          집행내역={업체[4].rows}
          비목이름={Object.fromEntries(업체[5].rows.map((c) => [c.코드, c.이름]))}
        />
      ) : 서류함?.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          서류 목록을 읽지 못했다: {서류함.error}
        </p>
      ) : 서류함 ? (
        <ProgramFiles 파일={서류함.파일} 보류={서류함.보류} 스코프="project" />
      ) : null}
    </div>
  )
}
