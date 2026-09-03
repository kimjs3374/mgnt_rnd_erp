import "server-only"
import { db, safeSelect } from "@/lib/db"
import { 사업자번호_숫자만 } from "@/lib/vendor-types"
import type { VendorRow, VendorDetail, VendorDocument, 미등록거래처 } from "@/lib/vendor-types"

/**
 * 업체(거래처) 대장 조회.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다 — 그 파일은 공고·달력·대시보드가 같이 써서 네 명이 동시에 연다.
 *   같은 파일을 둘이 열면 나중에 저장한 쪽이 덮어쓰고 git 이 막아주지 않는다(CLAUDE.md §1).
 *   실제로 세 번 났다(`_팀로그/memory/queries-ts-concurrent-save.md`).
 *
 * ⚠ `select("id,업체명,…")` 로 컬럼을 추리지 않는다. supabase-js 의 select 타입 파서가
 *   **한글 컬럼명을 식별자로 못 읽어** 컴파일이 깨진다. 이 저장소는 전부 `select("*")` 다.
 */

/** 업체 + 서류 확보 현황. 서류가 없는 업체가 위로 오게 정렬은 화면에서 한다. */
export const getVendorStatus = () =>
  safeSelect<VendorRow>("v_vendor_status", () =>
    db.from("v_vendor_status").select("*").order("업체명"),
  )

/** 상세 편집 폼이 쓰는 원본 행(뷰에 없는 업태·종목·주소·연락처까지). */
export const getVendorDetails = () =>
  safeSelect<VendorDetail>("vendors", () => db.from("vendors").select("*").order("업체명"))

/** 업체 서류 전부. 건수가 수백을 넘지 않아 통째로 받아 화면에서 업체별로 나눈다. */
export const getVendorDocuments = () =>
  safeSelect<VendorDocument>("vendor_documents", () =>
    db.from("vendor_documents").select("*").order("업로드일시", { ascending: false }),
  )

/**
 * **집행 건에는 있는데 대장에 없는 거래처.** 더미를 넣지 않았으니 이게 곧 첫 화면의 내용이다 —
 * 빈 표에 「업체를 추가하세요」만 띄우면 어디서 시작할지 알 수 없다.
 *
 * 사업자번호가 같으면 한 업체로 묶는다. 번호가 없는 건은 이름으로 묶되 **합치지 않는다** —
 * 표기가 다른 같은 업체일 수 있지만 그 판단은 사람이 한다(짐작으로 묶으면 대장이 거짓이 된다).
 * PostgREST 로 group by 를 하려면 뷰를 또 만들어야 해서, 7~수백 건이면 여기서 접는다.
 */
export async function getUnregisteredVendors(): Promise<{
  rows: 미등록거래처[]
  error: string | null
}> {
  const [exp, vendors] = await Promise.all([
    safeSelect<{ 거래처: string | null; 거래처_사업자번호: string | null; 합계: number | null }>(
      "expenses",
      () => db.from("expenses").select("*"),
    ),
    safeSelect<{ 사업자번호: string | null; 업체명: string }>("vendors", () =>
      db.from("vendors").select("*"),
    ),
  ])
  const error = exp.error ?? vendors.error
  if (error) return { rows: [], error }

  const 등록번호 = new Set(
    vendors.rows.map((v) => (v.사업자번호 ? 사업자번호_숫자만(v.사업자번호) : "")).filter(Boolean),
  )
  const 등록이름 = new Set(vendors.rows.map((v) => v.업체명.trim()))

  const 묶음 = new Map<string, 미등록거래처>()
  for (const e of exp.rows) {
    const 이름 = (e.거래처 ?? "").trim()
    const 번호 = e.거래처_사업자번호 ? 사업자번호_숫자만(e.거래처_사업자번호) : ""
    if (!이름 && !번호) continue
    if (번호 && 등록번호.has(번호)) continue
    if (!번호 && 등록이름.has(이름)) continue

    const 키 = 번호 || `name:${이름}`
    const 있던것 = 묶음.get(키)
    if (있던것) {
      있던것.건수 += 1
      있던것.합계 += Number(e.합계 ?? 0)
      continue
    }
    묶음.set(키, {
      거래처: 이름 || "이름 미상",
      사업자번호: 번호 || null,
      건수: 1,
      합계: Number(e.합계 ?? 0),
    })
  }

  // 많이 쓴 곳부터. 서류를 먼저 받아야 할 업체가 위로 온다.
  const rows = [...묶음.values()].sort((a, b) => b.합계 - a.합계 || b.건수 - a.건수)
  return { rows, error: null }
}
