// 공고 출처별 매핑 — 웹앱(서버 액션)과 수집 스크립트가 **같은 파일**을 쓴다.
//
// 왜 .mjs 인가: `app/actions/announcements.ts`(Next.js, TS)와 `scripts/collect-*.mjs`
// (맨 node)가 둘 다 import 해야 한다. 전에는 같은 로직이 두 곳에 복사돼 있었고,
// 그래서 한쪽만 고쳐진 채로 굴러갔다 — 목록 동기화 버튼과 배치 수집기가 서로 다른
// 필드를 저장하고 있었다. tsconfig 에 allowJs 가 켜져 있어 TS 쪽에서도 그냥 import 된다.
//
// ⚠ 여기의 지역 정규화 표는 db/91_bizinfo_facets.sql 의 app.지역정규화() 와 같아야 한다.
//   라벨이 갈라지면 대조가 에러 없이 전부 실패한다(회사 지역 "광주" vs 공고 지역 "전남광주").

/** 화면 필터의 지역 정렬 순서. 「전국」이 맨 앞이다 — 어느 회사든 해당되므로. */
export const 지역_정렬 = [
  "전국",
  "전남광주",
  "서울",
  "경기",
  "인천",
  "강원",
  "대전",
  "세종",
  "충북",
  "충남",
  "전북",
  "대구",
  "경북",
  "부산",
  "울산",
  "경남",
  "제주",
]

/**
 * 시도명 한 토막 → 정규화 라벨. 못 알아보면 null.
 *
 * ⚠ 이 세계관에서 전남과 광주는 「전남광주통합특별시」로 합쳐져 있다(기업마당 API 실측).
 *   그래서 전남·광주·전라남도·광주광역시를 전부 「전남광주」 하나로 모은다.
 *   나누면 매그나텍(전남광주 광산구)이 자기 지역 공고 43건 중 일부를 못 본다.
 *
 * 「전국」으로 함부로 넘기지 않는다 — 지역 제한이 있는 공고를 전국 공고로 둔갑시키면
 * 신청 자격이 없는 곳에 계획서를 쓰게 된다.
 */
export function 지역정규화(원문) {
  const s = String(원문 ?? "").trim()
  if (!s) return null
  if (/전남광주|전라남도|광주광역시|^전남$|^광주$/.test(s)) return "전남광주"
  if (/서울/.test(s)) return "서울"
  if (/부산/.test(s)) return "부산"
  if (/대구/.test(s)) return "대구"
  if (/인천/.test(s)) return "인천"
  if (/대전/.test(s)) return "대전"
  if (/울산/.test(s)) return "울산"
  if (/세종/.test(s)) return "세종"
  if (/경기/.test(s)) return "경기"
  if (/강원/.test(s)) return "강원"
  if (/충청북도|^충북$/.test(s)) return "충북"
  if (/충청남도|^충남$/.test(s)) return "충남"
  if (/전북|전라북도/.test(s)) return "전북"
  if (/경상북도|^경북$/.test(s)) return "경북"
  if (/경상남도|^경남$/.test(s)) return "경남"
  if (/제주/.test(s)) return "제주"
  if (/^전국$|전 ?지역/.test(s)) return "전국"
  return null
}

/**
 * 기업마당 공고의 지역 배열.
 *   ① 사업명 앞머리 대괄호 태그가 우선이다 — [전남광주] · [대구ㆍ경북]. 기관이 직접 붙인 것이다.
 *   ② 없으면 소관부처가 시도명인지 본다(jrsdInsttNm = "전남광주통합특별시" 43건).
 *   ③ 둘 다 아닌데 소관부처가 있으면 중앙부처다(중소벤처기업부·산업통상부…) → 전국.
 *   ④ 아무것도 없으면 null. 모른다는 뜻이고, {전국} 과 다르다.
 */
export function 공고지역(사업명, 소관부처) {
  const m = /^\s*\[([^\]]+)\]/.exec(String(사업명 ?? ""))
  if (m) {
    const 목록 = m[1]
      .split(/[ㆍ·,/]/)
      .map((t) => 지역정규화(t))
      .filter(Boolean)
    if (목록.length > 0) return Array.from(new Set(목록))
  }
  const 소관 = 지역정규화(소관부처)
  if (소관) return [소관]
  if (소관부처) return ["전국"]
  return null
}

/**
 * 접수기간 파싱. reqstBeginEndDe 는 **절반 넘게 날짜가 아니다**(상시·소진시·선착순·상이).
 * 지어내지 말고 유형으로 나눈다. 프로토타입 gongo.py(2026-08-21 검증) 그대로.
 */
export function 마감파싱(원문) {
  const s = String(원문 ?? "").trim()
  const m = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/.exec(s)
  if (m) return { 유형: "dated", 시작: m[1], 종료: m[2] }
  for (const [키, 유형] of [
    ["상시", "상시"],
    ["소진", "소진시"],
    ["선착순", "소진시"],
    ["상이", "상이"],
    ["완료", "완료시"],
  ]) {
    if (s.includes(키)) return { 유형, 시작: null, 종료: null }
  }
  return { 유형: "미상", 시작: null, 종료: null }
}

/** "20260901" → "2026-09-01". 8자리가 아니면 null — 지어내지 않는다. */
export function yyyymmdd(s) {
  const t = String(s ?? "").replace(/\D/g, "")
  if (t.length !== 8) return null
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
}

/** HTML 태그를 걷어내고 공백을 정리한다. bsnsSumryCn 이 HTML 로 온다. */
export function 태그제거(s) {
  return String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * 문의처에서 개인 실명으로 보이는 토막을 지운다 — CLAUDE.md §2-6(개인정보는 항목 자체를 만들지 않는다).
 * 기업마당 refrncNm 은 "안산시 소상공인지원과 031-481-2842" 처럼 부서+전화가 보통이지만
 * 담당자 이름이 섞여 오는 것이 있다. 부서명·전화만 남긴다.
 */
export function 문의처정리(s) {
  const t = 태그제거(s)
  if (!t) return null
  return (
    t
      // "홍길동 주무관", "김철수 팀장" 같은 2~4자 한글 이름 + 직책
      .replace(/[가-힣]{2,4}\s*(주무관|사무관|담당자|팀장|과장|대리|주임|연구원|매니저)/g, "")
      .replace(/\s{2,}/g, " ")
      .trim() || null
  )
}

/**
 * 기업마당 오픈API 레코드 → announcements 행(목록 필드).
 * 첨부 다운로드·LLM 판독은 여기서 하지 않는다 — 그건 scripts/collect-bizinfo.mjs 의 정밀 파싱 단계다.
 *
 * 실측 필드(2026-09-03, 300건): pldirSportRealmLclasCodeNm 8종 · trgetNm 7종 ·
 * jrsdInsttNm 에 전남광주통합특별시 43건. 전부 API 가 그냥 주는 값인데 전에는 버리고 있었다.
 */
export function 기업마당행(rec) {
  const 마감 = 마감파싱(rec.reqstBeginEndDe)
  const 사업명 = String(rec.pblancNm ?? "").trim()
  return {
    출처: "기업마당",
    출처_id: rec.pblancId,
    사업명,
    소관부처: rec.jrsdInsttNm ?? null,
    전문기관: rec.excInsttNm ?? null,
    지역코드: 공고지역(사업명, rec.jrsdInsttNm),
    지원분야: rec.pldirSportRealmLclasCodeNm ?? null,
    지원대상: rec.trgetNm ?? null,
    접수시작: 마감.시작,
    접수종료: 마감.종료,
    마감유형: 마감.유형,
    공고일: yyyymmdd(String(rec.creatPnttm ?? "").slice(0, 10).replace(/-/g, "")),
    공고url: rec.pblancUrl ?? null,
    요약: 태그제거(rec.bsnsSumryCn).slice(0, 2000) || null,
    문의처: 문의처정리(rec.refrncNm),
    공고문_파일명: rec.printFileNm || null,
    공고문_url: rec.printFlpthNm || null,
  }
}

/**
 * K-Startup(창업진흥원) 오픈API 레코드 → announcements 행.
 *
 * 기업마당과 달리 **지역·접수일자를 정제된 필드로 그대로 준다**(supt_regin, pbanc_rcpt_*_dt).
 * 그래서 사업명 태그를 파싱할 필요가 없다 — 있는 값을 정규화만 한다.
 *
 * 접수일자가 없는 레코드가 있다(상시 모집·수시). 그 경우 마감유형을 「미상」으로 두고
 * 날짜를 지어내지 않는다.
 */
export function 케이스타트업행(rec) {
  const 시작 = yyyymmdd(rec.pbanc_rcpt_bgng_dt)
  const 종료 = yyyymmdd(rec.pbanc_rcpt_end_dt)
  const 지역 = 지역정규화(rec.supt_regin)
  return {
    출처: "K-Startup",
    출처_id: String(rec.pbanc_sn ?? ""),
    사업명: String(rec.biz_pbanc_nm ?? "").trim(),
    소관부처: rec.pbanc_ntrp_nm ?? null,
    전문기관: rec.sprv_inst ?? null,
    지역코드: 지역 ? [지역] : null,
    지원분야: 태그제거(rec.supt_biz_clsfc) || null,
    지원대상: rec.aply_trgt ?? null,
    접수시작: 시작,
    접수종료: 종료,
    // 시작과 종료가 둘 다 있어야 날짜형이다. 하나만 있으면 D-day 를 계산할 수 없다.
    마감유형: 시작 && 종료 ? "dated" : "미상",
    공고일: 시작,
    공고url: rec.detl_pg_url ?? null,
    요약: 태그제거(rec.pbanc_ctnt).slice(0, 2000) || null,
    문의처: 문의처정리(
      [rec.biz_prch_dprt_nm, rec.prch_cnpl_no].filter(Boolean).join(" "),
    ),
    공고문_파일명: null,
    // K-Startup 오픈API 는 첨부파일 경로를 주지 않는다. 상세페이지에 있지만 스크래핑 대상이 아니다.
    공고문_url: null,
  }
}
