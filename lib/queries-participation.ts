import "server-only"
import { db, safeSelect } from "@/lib/db"
import { 국책참여율_초과, 국책인가, type 참여줄, type 초과 } from "@/lib/participation"

/**
 * **다른 과제까지 가로질러** 국책 참여율을 더한다.
 *
 * 사용자 지시(2026-09-04): 「내부 연구원의 국책 과제 참여율을 모두 합쳐서 100% 가 넘지 않게.
 * 민간과제의 참여율은 반영하지 않아.」
 *
 * ⚠ **과제 하나 안에서는 못 잡는다.** `lib/personnel.ts` 의 `참여율초과()` 는 그 과제 줄만 더한다.
 *   그건 그것대로 두고(그 화면의 즉시 경고), 여기서 과제를 가로지르는 판정을 한다.
 *
 * ⚠ **판정은 서버에서 한다.** 화면에서만 막으면 우회된다 — 참여율 초과는 정산에서 반려되는 항목이다.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다. 네 명이 동시에 여는 파일이라 저장 충돌이 두 번 났다.
 */

type 인건비Raw = {
  과제_id: number
  표시명: string
  연구자등록번호: string | null
  참여율: number | string
  참여시작일: string | null
  참여종료일: string | null
}

type 과제Raw = {
  id: number
  과제명: string
  과제코드: string | null
  사업유형: string | null
  시작일: string | null
  종료일: string | null
}

/**
 * 지금 저장하려는 줄(`이번줄`)과 **다른 과제에 이미 있는 줄**을 합쳐 초과를 판정한다.
 *
 * 같은 과제의 기존 줄은 `이번줄` 이 대체하므로 **빼고** 센다 —
 * 안 빼면 고치는 순간 자기 자신과 겹쳐 늘 초과로 잡힌다.
 */
export async function 국책참여율초과(
  과제_id: number,
  이번줄: {
    표시명: string
    연구자등록번호?: string | null
    참여율: number | string
    참여시작일?: string | null
    참여종료일?: string | null
  }[],
): Promise<초과[]> {
  // ⚠ 한글 컬럼명을 select 문자열에 넣으면 supabase-js 타입 파서가 컴파일에서 막는다. `*` 로 받는다.
  const [인건비, 과제] = await Promise.all([
    safeSelect<인건비Raw>("personnel_costs", () => db.from("personnel_costs").select("*")),
    safeSelect<과제Raw>("projects", () => db.from("projects").select("*")),
  ])
  // 못 읽었으면 막지 않는다. 조회 실패로 저장을 못 하게 만드는 쪽이 더 나쁘다.
  if (인건비.error || 과제.error) return []

  const 과제맵 = new Map(과제.rows.map((p) => [Number(p.id), p]))
  const 붙이기 = (과제id: number) => {
    const p = 과제맵.get(과제id)
    return {
      과제명: p?.과제명 ?? null,
      과제코드: p?.과제코드 ?? null,
      사업유형: p?.사업유형 ?? null,
      과제시작일: p?.시작일 ?? null,
      과제종료일: p?.종료일 ?? null,
    }
  }

  const 남의줄: 참여줄[] = 인건비.rows
    .filter((r) => Number(r.과제_id) !== 과제_id)
    .map((r) => ({
      과제_id: Number(r.과제_id),
      표시명: r.표시명,
      연구자등록번호: r.연구자등록번호,
      참여율: Number(r.참여율 || 0),
      참여시작일: r.참여시작일,
      참여종료일: r.참여종료일,
      ...붙이기(Number(r.과제_id)),
    }))

  const 내줄: 참여줄[] = 이번줄.map((r) => ({
    과제_id,
    표시명: r.표시명,
    연구자등록번호: r.연구자등록번호 ?? null,
    참여율: Number(r.참여율 || 0),
    참여시작일: r.참여시작일 ?? null,
    참여종료일: r.참여종료일 ?? null,
    ...붙이기(과제_id),
  }))

  return 국책참여율_초과([...내줄, ...남의줄])
}

/**
 * 화면에 미리 보여줄 용도 — **한 사람이 지금 국책 과제에서 쓰고 있는 참여율**.
 * 저장을 막는 것은 위 함수고, 이건 「이 사람 지금 몇 % 남았나」를 보여주는 데 쓴다.
 */
export async function 사람별_국책참여율(제외과제_id?: number) {
  const [인건비, 과제] = await Promise.all([
    safeSelect<인건비Raw>("personnel_costs", () => db.from("personnel_costs").select("*")),
    safeSelect<과제Raw>("projects", () => db.from("projects").select("*")),
  ])
  if (인건비.error || 과제.error) return {} as Record<string, number>

  const 과제맵 = new Map(과제.rows.map((p) => [Number(p.id), p]))
  const out: Record<string, number> = {}
  for (const r of 인건비.rows) {
    const pid = Number(r.과제_id)
    if (제외과제_id != null && pid === 제외과제_id) continue
    const p = 과제맵.get(pid)
    if (!국책인가(p?.사업유형 ?? null)) continue
    out[r.표시명] = (out[r.표시명] ?? 0) + Number(r.참여율 || 0)
  }
  return out
}
