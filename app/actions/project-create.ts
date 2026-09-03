"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
// ⚠ `"use server"` 파일은 export 가 전부 async 함수여야 한다. 상수는 lib 에 둔다.
import { 과제상태값 } from "@/lib/project-entry"
import type { 과제상태 } from "@/lib/project-entry"

/**
 * 대장에 기존 사업을 **직접 옮겨 담는다.**
 *
 * ⚠ [지원 등록](`app/actions/apply.ts`)과 성격이 다르다. 헷갈리면 대장이 오염된다.
 *
 *   | | 지원 등록 | 옮겨 담기(여기) |
 *   |---|---|---|
 *   | 입구 | 공고 상세 | 대장 화면 |
 *   | 언제 | **지금부터** 신청하는 건 | **이미 하고 있거나 끝난** 건 |
 *   | 공고_id | 있다 | 없다(공고 레코드가 아예 없는 건이다) |
 *   | 기본 상태 | 신청중 | 수행중 |
 *
 * 케이오시가 엑셀로 관리하던 10건처럼 **공고 레코드가 없는 과거 건**을 담는 길이다.
 * 이 길이 없으면 시스템을 처음 켠 회사는 대장이 영원히 빈다.
 *
 * 출처는 `app.project_entry_log` 에 남긴다(`db/99`) — 어느 줄이 사람이 옮겨 담은 것인지
 * 나중에 못 대면 그 줄은 근거가 없는 줄이다(CLAUDE.md §6-1).
 *
 * ⚠ 권한(2026-09-04) — 마스터 데이터(과제 신규 등록)는 관리자 이상만. 일반회원은 조회만.
 */

export type CreateResult = {
  ok: boolean
  error?: string
  /** 만들어진 과제 id. 화면이 바로 그 과제로 보낸다. */
  id?: number
  과제코드?: string
  /** 막을 정도는 아니지만 사람이 봐야 하는 것. 성공과 같이 돌려준다. */
  주의?: string[]
}

function 숫자(v: FormDataEntryValue | null): number | null {
  if (v == null) return null
  const s = String(v).replace(/[,\s]/g, "")
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

function 글자(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim()
  return s || null
}

const 원 = (n: number) => n.toLocaleString("ko-KR")

/**
 * 과제코드를 안 주면 임시 코드를 만든다.
 *
 * 지자체 사업은 `RS-2025-…` 같은 국가 R&D 과제번호가 아예 없는 경우가 많다.
 * 그렇다고 코드를 비워 둘 수는 없어서(`과제코드` 는 NOT NULL UNIQUE) 임시 코드를 붙이되,
 * **`MANUAL-` 로 시작하게 해서 「이건 우리가 붙인 번호다」가 눈에 보이게 한다.**
 * 기관이 준 번호인 척하지 않는다.
 */
async function 임시코드() {
  const 해 = new Date().getFullYear()
  const { data } = await db.from("projects").select("*").like("과제코드", `MANUAL-${해}-%`)
  const 다음 = (data?.length ?? 0) + 1
  // 같은 초에 둘이 누르면 겹칠 수 있다. 겹치면 insert 가 23505 로 막히고 화면이 다시 시도하라고 말한다.
  return `MANUAL-${해}-${String(다음).padStart(3, "0")}`
}

export async function createProject(formData: FormData): Promise<CreateResult> {
  try {
    // 마스터 데이터 등록은 관리자 이상만. who는 아래 출처 기록(등록자)에도 그대로 쓴다.
    const who = await getCurrentUser()
    if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
      return { ok: false, error: "관리자 이상만 과제를 등록할 수 있습니다." }
    }

    const 과제명 = 글자(formData.get("과제명"))
    const 시작일 = 글자(formData.get("시작일"))
    const 종료일 = 글자(formData.get("종료일"))
    const 총사업비 = 숫자(formData.get("총사업비"))

    // ── 없으면 줄을 만들 수 없는 것들. DB 가 NOT NULL 로 막기 전에 사람 말로 돌려준다.
    if (!과제명) return { ok: false, error: "과제명을 넣으세요." }
    if (!시작일 || !종료일) return { ok: false, error: "수행기간(시작일·종료일)을 넣으세요." }
    if (종료일 < 시작일) return { ok: false, error: "종료일이 시작일보다 빠릅니다." }
    if (총사업비 == null) return { ok: false, error: "총사업비를 넣으세요." }
    if (총사업비 < 0) return { ok: false, error: "총사업비가 음수입니다." }

    const 상태 = (글자(formData.get("상태")) ?? "수행중") as 과제상태
    if (!과제상태값.includes(상태)) {
      // ⚠ DB 가 쓰는 낱말은 「수행중」이다. 「수행」으로 넣으면 대장 집계가 조용히 0 이 된다.
      return { ok: false, error: `상태는 ${과제상태값.join(" · ")} 중 하나여야 합니다.` }
    }

    const 연차 = 숫자(formData.get("연차")) ?? 1
    if (연차 < 1) return { ok: false, error: "연차는 1 이상이어야 합니다." }

    const 정부지원금 = 숫자(formData.get("정부지원금"))
    const 기관부담_현금 = 숫자(formData.get("기관부담_현금"))
    const 기관부담_현물 = 숫자(formData.get("기관부담_현물"))

    // ── 막지는 않고 말만 하는 것들 ────────────────────────────────────────
    // 재원 합이 총사업비와 다른 것은 **틀린 게 아닐 수 있다** — 현물 산정이 협약 뒤에 정해지는
    // 사업도 있다. 여기서 막으면 옮겨 담기가 통째로 멈춘다. 대신 반드시 눈에 보이게 한다.
    const 주의: string[] = []
    if (정부지원금 != null || 기관부담_현금 != null || 기관부담_현물 != null) {
      const 합 = (정부지원금 ?? 0) + (기관부담_현금 ?? 0) + (기관부담_현물 ?? 0)
      if (합 !== 총사업비) {
        주의.push(
          `재원 합계 ${원(합)}원이 총사업비 ${원(총사업비)}원과 ${원(Math.abs(합 - 총사업비))}원 다릅니다. 연구비 계상 탭에서 맞추세요.`,
        )
      }
    }

    const 과제코드입력 = 글자(formData.get("과제코드"))
    const 과제코드 = 과제코드입력 ?? (await 임시코드())
    if (!과제코드입력) {
      주의.push(`과제코드가 없어 임시로 ${과제코드} 를 붙였습니다. 기관 번호를 받으면 바꾸세요.`)
    }

    // 같은 이름이 이미 있으면 막지 않고 알려만 준다 — 연차가 다른 같은 사업일 수 있다.
    const { data: 동명 } = await db.from("projects").select("*").eq("과제명", 과제명)
    if ((동명?.length ?? 0) > 0) {
      주의.push(`같은 이름의 과제가 이미 ${동명?.length}건 있습니다. 연차가 다른 건인지 확인하세요.`)
    }

    const 행 = {
      과제코드,
      과제명,
      부처: 글자(formData.get("부처")),
      전문기관: 글자(formData.get("전문기관")),
      사업명: 글자(formData.get("사업명")),
      협약번호: 글자(formData.get("협약번호")),
      사업유형: 글자(formData.get("사업유형")),
      시작일,
      종료일,
      연차,
      총사업비,
      정부지원금,
      기관부담_현금,
      기관부담_현물,
      상태,
      비고: 글자(formData.get("비고")),
      // ⚠ 공고_id 는 비운다. **이 길로 들어온 건은 공고 레코드가 없는 건이다.**
      //    아무 공고나 붙이면 그 공고의 규정·한도가 이 과제에 적용돼 계산이 통째로 틀어진다.
    }

    const { data, error } = await db.from("projects").insert(행).select("*")
    if (error) {
      // 23505 = unique 위반. 과제코드가 겹친 것이다 — 사람이 고칠 수 있게 그대로 말한다.
      if (error.code === "23505" || /duplicate key/i.test(error.message)) {
        return { ok: false, error: `과제코드 「${과제코드}」 는 이미 있습니다. 다른 코드를 넣으세요.` }
      }
      return { ok: false, error: error.message }
    }
    const 만든것 = (data ?? [])[0] as { id?: number } | undefined
    if (!만든것?.id) return { ok: false, error: "과제는 만들어졌는데 id 를 못 받았습니다. 대장을 새로고침하세요." }

    // 출처를 남긴다. 여기서 실패해도 과제는 이미 있으므로 되돌리지 않는다 —
    // 대장 한 줄이 사라지는 것보다 출처 한 줄이 비는 편이 낫다. 대신 주의로 말한다.
    const { error: logErr } = await db.from("project_entry_log").insert({
      과제_id: 만든것.id,
      등록경로: "수기입력",
      등록자: who.이름,
      등록자_인증: who.인증,
    })
    if (logErr) 주의.push(`출처를 기록하지 못했습니다: ${logErr.message}`)

    revalidatePath("/projects")
    revalidatePath("/programs")
    revalidatePath(`/projects/${만든것.id}`)
    return { ok: true, id: 만든것.id, 과제코드, 주의 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
