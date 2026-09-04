"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"

/**
 * 공고 → 지원 등록 → 선정 → 사업대장.
 *
 * **대장은 따로 만들지 않는다.** `app.projects` 한 테이블이 지원사업 대장이자 과제 대장이고,
 * `app.v_program_ledger` 가 그걸 대장 모양으로 보여준다. 그래서 지원을 등록하는 순간
 * `/programs` 에 한 줄이 생기고, 선정되면 그 줄이 그대로 과제가 된다 —
 * 공고와 대장을 잇는 것이 아니라 **처음부터 같은 한 건**이라는 뜻이다(CLAUDE.md §0.5 흐름).
 *
 *   공고 → [지원 등록] 선정결과=접수 · 상태=신청
 *        → [발표·심사]  선정결과=발표심사
 *        → [선정]       선정결과=선정 · 상태=수행중  → 과제사업 대장에 뜬다
 *        → [미선정]     선정결과=미선정 · 상태=미선정
 *
 * ⚠ 한 공고에 두 건을 막지 않는다. 이 공고(제2026-57호) 원문 p.27 예시가 **내역1·내역2** 로
 *   갈려 있어서, 같은 공고에 과제가 둘 생기는 것이 정상인 사업이 실제로 있다.
 *   대신 이미 등록된 게 있으면 먼저 알려주고, 사용자가 `강제` 로 다시 부르면 만든다.
 */

export type ApplyResult = {
  ok: boolean
  error?: string
  /** 이미 등록된 지원이 있을 때 그 목록을 돌려준다(사람이 보고 판단하도록). */
  기존?: { id: number; 과제명: string; 선정결과: string | null; 신청일: string | null }[]
  과제_id?: number
}

const 오늘 = () => new Date().toISOString().slice(0, 10)

/** 과제코드는 NOT NULL·UNIQUE 다. 신청 단계엔 RS- 번호가 없으니 임시 코드를 만든다. */
function 임시코드(공고_id: number) {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `APP-${공고_id}-${yy}${mm}${dd}`
}

export async function applyToAnnouncement(입력: {
  공고_id: number
  과제명?: string
  /** 사업기간. projects.시작일·종료일이 NOT NULL 이라 반드시 받는다(예정이어도 적는다). */
  시작일: string
  종료일: string
  지원금액?: number
  과제코드?: string
  강제?: boolean
}): Promise<ApplyResult> {
  try {
    const 공고_id = Number(입력.공고_id)
    if (!Number.isInteger(공고_id) || 공고_id <= 0) return { ok: false, error: "공고를 찾을 수 없다." }
    if (!입력.시작일 || !입력.종료일) {
      return { ok: false, error: "사업기간(시작일·종료일)을 넣어야 합니다. 예정이어도 적습니다." }
    }
    if (입력.시작일 > 입력.종료일) return { ok: false, error: "종료일이 시작일보다 앞입니다." }

    const { data: ann, error: annErr } = await db
      .from("announcements")
      .select("*")
      .eq("id", 공고_id)
      .limit(1)
    if (annErr) return { ok: false, error: annErr.message }
    const a = (ann ?? [])[0] as
      | {
          사업명?: string
          소관부처?: string | null
          전문기관?: string | null
          사업유형?: string | null
          공고일?: string | null
          접수종료?: string | null
        }
      | undefined
    if (!a) return { ok: false, error: "공고를 찾을 수 없다." }

    // 이미 이 공고로 등록한 건이 있는지 먼저 본다(위 ⚠ 참조).
    const { data: dup } = await db.from("projects").select("*").eq("공고_id", 공고_id)
    const 기존 = (dup ?? []).map((r) => {
      const o = r as Record<string, unknown>
      return {
        id: Number(o.id),
        과제명: String(o.과제명 ?? ""),
        선정결과: (o.선정결과 as string) ?? null,
        신청일: (o.신청일 as string) ?? null,
      }
    })
    if (기존.length && !입력.강제) {
      return {
        ok: false,
        error: `이 공고로 이미 ${기존.length}건 등록돼 있습니다. 내역사업이 갈린 경우가 아니면 그 건을 쓰세요.`,
        기존,
      }
    }

    // 과제코드 중복은 DB 가 막는다(UNIQUE). 부딪히면 뒤에 번호를 붙인다.
    let 코드 = (입력.과제코드 ?? "").trim() || 임시코드(공고_id)
    for (let i = 2; i <= 9; i++) {
      const { data: hit } = await db.from("projects").select("id").eq("과제코드", 코드).limit(1)
      if (!hit?.length) break
      코드 = `${입력.과제코드?.trim() || 임시코드(공고_id)}-${i}`
    }

    const row = {
      과제코드: 코드,
      과제명: (입력.과제명 ?? "").trim() || (a.사업명 ?? "이름 없는 지원사업"),
      사업명: a.사업명 ?? null,
      부처: a.소관부처 ?? null,
      전문기관: a.전문기관 ?? null,
      사업유형: a.사업유형 ?? null,
      공고_id,
      공고일: a.공고일 ?? null,
      마감일: a.접수종료 ?? null,
      신청일: 오늘(),
      // 접수 → 발표심사 → 선정/미선정. 대장의 「신청접수및결과」 열이 이 값을 읽는다.
      선정결과: "접수",
      // ⚠ 상태를 '수행중' 으로 두지 않는다. 대시보드의 「수행 중」 카드가 신청 건을 세면 거짓말이 된다.
      //    값은 **DB 에 이미 있는 어휘를 쓴다** — 시드가 `수행중 / 신청중 / 종료` 를 쓰고 있고
      //    새 낱말('신청')을 넣으면 다른 사람 화면의 배지·필터가 그 값을 모른다.
      상태: "신청중",
      시작일: 입력.시작일,
      종료일: 입력.종료일,
      // 협약 전이라 총사업비는 아직 없다. NOT NULL 이라 0 으로 두고, 협약 때 재원 구성 카드에서 채운다.
      총사업비: 0,
      지원금액: 입력.지원금액 == null ? null : Math.max(0, Math.round(Number(입력.지원금액))),
      비고: "공고 탐색에서 지원 등록",
    }

    const { data: ins, error } = await db.from("projects").insert(row).select("*")
    if (error) return { ok: false, error: error.message }
    const 과제_id = Number(((ins ?? [])[0] as { id?: number } | undefined)?.id)

    revalidatePath("/programs")
    revalidatePath("/projects")
    revalidatePath("/dashboard")
    revalidatePath(`/announcements/${공고_id}`)
    revalidatePath(`/project-announcements/${공고_id}`)
    return { ok: true, 과제_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 발표·심사 → 선정 / 미선정. 선정되면 상태가 「수행중」으로 바뀌어 과제사업 대장에 뜬다. */
export async function setSelectionResult(
  과제_id: number,
  결과: "발표심사" | "선정" | "미선정" | "접수",
  결과일?: string,
): Promise<ApplyResult> {
  try {
    if (!Number.isInteger(과제_id) || 과제_id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }
    const 날 = 결과일 || 오늘()

    const patch: Record<string, unknown> = { 선정결과: 결과 }
    if (결과 === "발표심사") patch.발표심사일 = 날
    if (결과 === "선정") {
      patch.선정결과일 = 날
      patch.상태 = "수행중"
    }
    if (결과 === "미선정") {
      patch.선정결과일 = 날
      // 미선정 건도 대장에 남긴다 — 왜 떨어졌는지가 다음 신청의 근거다(설계원칙 1).
      // 상태는 DB 에 있는 어휘(`종료`)를 쓰고, 떨어졌다는 사실은 `선정결과=미선정` 이 말한다.
      patch.상태 = "종료"
    }
    if (결과 === "접수") {
      patch.선정결과일 = null
      patch.상태 = "신청중"
    }

    // ⚠ `select("공고_id")` 처럼 **한글 컬럼명을 select 문자열에 넣으면** supabase-js 의
    //    타입 파서가 컴파일 단계에서 막는다(`ParserError<"Expected identifier">`).
    //    런타임이 아니라 타입 문제라 `*` 로 받고 좁혀 읽는다 — queries.ts 도 같은 이유로 그렇게 한다.
    const { data, error } = await db.from("projects").update(patch).eq("id", 과제_id).select("*")
    if (error) return { ok: false, error: error.message }

    const 공고_id = Number(((data ?? [])[0] as { 공고_id?: number } | undefined)?.공고_id ?? 0)
    revalidatePath("/programs")
    revalidatePath("/projects")
    revalidatePath("/dashboard")
    revalidatePath(`/projects/${과제_id}`)
    if (공고_id) {
      revalidatePath(`/announcements/${공고_id}`)
      revalidatePath(`/project-announcements/${공고_id}`)
    }
    return { ok: true, 과제_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 지원 등록 삭제 — 잘못 등록했거나 테스트로 넣은 건을 되돌리는 길.
 *
 * ⚠ 아무 때나 지우지 않는다. 예산·집행·서류 확인 같은 실제 업무가 이미 그 위에
 *   쌓였으면 삭제가 아니라 상태 변경(미선정 등)으로 남겨야 한다 — 지우면 그 과제에
 *   돈을 왜 그렇게 썼는지 추적할 방법이 없어진다(CLAUDE.md 설계원칙 1, "핵심은 기록").
 *   그래서 예산·집행·문서·점검 중 하나라도 붙어 있으면 막는다.
 */
export async function deleteApplication(과제_id: number): Promise<ApplyResult> {
  try {
    if (!Number.isInteger(과제_id) || 과제_id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }

    const [budgets, expenses, docs, checks] = await Promise.all([
      db.from("budgets").select("id").eq("과제_id", 과제_id).limit(1),
      db.from("expenses").select("id").eq("과제_id", 과제_id).limit(1),
      db.from("program_documents").select("id").eq("과제_id", 과제_id).limit(1),
      db.from("program_checks").select("id").eq("과제_id", 과제_id).limit(1),
    ])
    if (budgets.data?.length || expenses.data?.length || docs.data?.length || checks.data?.length) {
      return {
        ok: false,
        error: "이미 예산·집행·서류가 쌓여 있어 삭제할 수 없습니다 — 대신 「미선정」으로 남기세요.",
      }
    }

    const { data, error } = await db.from("projects").select("*").eq("id", 과제_id).limit(1)
    if (error) return { ok: false, error: error.message }
    const 공고_id = Number((data?.[0] as { 공고_id?: number } | undefined)?.공고_id ?? 0)

    const { error: delError } = await db.from("projects").delete().eq("id", 과제_id)
    if (delError) return { ok: false, error: delError.message }

    revalidatePath("/programs")
    revalidatePath("/projects")
    revalidatePath("/dashboard")
    if (공고_id) {
      revalidatePath(`/announcements/${공고_id}`)
      revalidatePath(`/project-announcements/${공고_id}`)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
