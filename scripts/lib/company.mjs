// 회사 프로필 한 줄 요약 — 공고 관련성 거르기(selectRelevant)와 자격판정 점수 매기기
// (scoreEligibility) 양쪽이 같은 회사 정보를 쓴다. 따로 만들면 두 곳이 다른 말을 하게 된다.
import { pgSelect } from "./pgrest.mjs"

/** company_profile 최신 연도 한 줄 요약. 프로필이 없으면 null — 걸러낼 근거가 없다는 뜻. */
export async function companyProfileText() {
  const rows = await pgSelect("company_profile", "order=결산연도.desc&limit=1")
  const c = rows[0]
  if (!c) return null
  const parts = [
    c.회사명 ?? null,
    c.업종명?.length ? `업종 ${c.업종명.join(" · ")}` : null,
    c.주요제품 ? `주요제품 ${c.주요제품}` : null,
    c.소재지 ? `소재지 ${c.소재지}` : null,
    c.기업규모 ?? null,
    c.지원대상_유형?.length ? `지원대상 유형 ${c.지원대상_유형.join(", ")}` : null,
    // 아래는 대표자 확인 결과 합성값이라 비워진 필드들이다(db/92_company_profile_magnatech.sql) —
    // null 이면 그냥 빠진다. 지어내서 채우지 않는다.
    c.ksic_코드?.length ? `업종코드(KSIC) ${c.ksic_코드.join(", ")}` : null,
    c.종업원수 != null ? `종업원 ${c.종업원수}명` : null,
    c.매출액 != null ? `매출액 약 ${Math.round(c.매출액 / 1e8)}억원` : null,
    c.기업부설연구소 ? "기업부설연구소 보유" : null,
    c.rnd_집약도 != null ? `R&D 집약도 ${c.rnd_집약도}%` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}
