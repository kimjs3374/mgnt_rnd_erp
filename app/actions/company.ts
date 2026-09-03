"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

export type SaveResult = { ok: boolean; message: string }

/**
 * 빈 문자열과 0 을 구분한다.
 * 「안 적었다(null)」와 「0이다」는 다른 뜻인데, FormData 는 둘 다 문자열로 준다.
 * 여기서 안 갈라 두면 매출 0원인 회사와 매출을 모르는 회사가 같은 값이 된다.
 */
function 숫자(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(/,/g, "")
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function 문자(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim()
  return s === "" ? null : s
}

/** 쉼표로 끊어 배열로. 빈 칸은 null 로 둔다 — 빈 배열과 「모른다」를 구분한다. */
function 배열(v: FormDataEntryValue | null): string[] | null {
  const s = String(v ?? "").trim()
  if (s === "") return null
  const arr = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  return arr.length ? arr : null
}

/**
 * 회사 프로필 저장.
 *
 * 이 값들이 공고 탐색의 대조 기준이다 — 지역코드·지원대상_유형이 비면 「우리 회사 조건」이
 * 아무것도 못 거른다. 그래서 화면이 비어 있는 항목을 세어 경고를 띄운다.
 *
 * **추측으로 채우지 않는다.** 모르는 값은 비워 두는 것이 맞다. 지어낸 재무값으로
 * 자격을 판정하면 틀린 답에 근거까지 붙여서 내놓게 된다(CLAUDE.md §6).
 *
 * ⚠ 권한(2026-09-04) — 회사 프로필은 마스터 데이터라 관리자 이상만 저장할 수 있다.
 */
export async function saveCompany(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const who = await getCurrentUser()
  if (!who.인증 || (who.role !== "admin" && who.role !== "super_admin")) {
    return { ok: false, message: "회사 프로필 저장은 관리자 이상만 할 수 있습니다." }
  }

  const 결산연도 = 숫자(formData.get("결산연도"))
  if (결산연도 == null) {
    return { ok: false, message: "결산연도는 있어야 한다 — 어느 해 기준인지 모르면 재무값이 뜻이 없다." }
  }

  const row = {
    결산연도,
    회사명: 문자(formData.get("회사명")),
    사업자등록번호: 문자(formData.get("사업자등록번호")),
    대표자: 문자(formData.get("대표자")),
    소재지: 문자(formData.get("소재지")),
    지역코드: 배열(formData.get("지역코드")),
    기업규모: 문자(formData.get("기업규모")),
    업종명: 배열(formData.get("업종명")),
    주요제품: 문자(formData.get("주요제품")),
    설립일: 문자(formData.get("설립일")),
    지원대상_유형: 배열(formData.get("지원대상_유형")),
    ksic_코드: 배열(formData.get("ksic_코드")),
    종업원수: 숫자(formData.get("종업원수")),
    매출액: 숫자(formData.get("매출액")),
    매출증가율: 숫자(formData.get("매출증가율")),
    부채비율: 숫자(formData.get("부채비율")),
    rnd_집약도: 숫자(formData.get("rnd_집약도")),
    기업부설연구소: formData.get("기업부설연구소") === "on",
    자본전액잠식: formData.get("자본전액잠식") === "on",
    출처_문서: 문자(formData.get("출처_문서")),
    updated_at: new Date().toISOString(),
  }

  const { error } = await db.from("company_profile").update(row).eq("id", 1)
  if (error) return { ok: false, message: `저장 실패: ${error.message}` }

  // 공고 탐색이 이 값으로 걸러진다 — 저장 즉시 반영되어야 한다.
  revalidatePath("/company")
  revalidatePath("/announcements")
  return { ok: true, message: "저장했다. 공고 탐색의 「우리 회사 조건」에 바로 반영된다." }
}
