// 규정 문서함 초기 등록 — **이미 서버에 있는 실제 원문 4건**을 버킷과 DB 로 옮긴다.
//
//   왜 필요한가
//     `app.funding_share_rules` 는 이미 쪽수로 인용하고 있다 —
//     「p.31 정부지원 비율표」 「p.18 연구수당 수정인건비 20% 이내」.
//     그런데 그 쪽수가 가리키는 **원본**은 `data/real/공고규정/`(gitignore)에만 있어서
//     화면에서 열 수 없었다. 규정 문서함이 비어 있으면 「근거를 댄다」는 주장이 화면에서 증명되지 않는다.
//
//   범위를 어떻게 갈랐나 — 지어내지 않는다
//     · 공고문·유의사항 → **그 공고에만**(id 837). 다른 공고에 같은 비율을 적용하면 그게 거짓이다.
//     · 관리지침·사용기준 → **NATIONAL_RND 전체.** 국가 R&D 에 걸리는 규정이지 모든 사업이 아니다.
//     · 공통(모든 사업) 은 **비워 둔다.** 지자체 사업까지 걸리는 상위 고시를 아직 확인하지 못했다.
//       빈 카드가 뜨는 편이 잘못 분류된 문서보다 낫다(CLAUDE.md §6-5 「모르면 모른다고 한다」).
//
//   멱등하다 — 같은 파일명이 이미 등록돼 있으면 건너뛴다. 두 번 돌려도 중복이 안 생긴다.
//
//   실행: cd /web/rnd && node scripts/seed-rule-docs.mjs
import { readFileSync, existsSync } from "node:fs"
import { basename } from "node:path"
import { env, pgSelect, pgInsert } from "./lib/pgrest.mjs"

const BASE = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const 버킷 = "evidence"
const 원문폴더 = "data/real/공고규정"

/** 공고 837 = (제2026-57호) 2026년 지역혁신선도기업육성(R&D) 시행계획 공고. `app.projects` P01 이 이 공고를 본다. */
const 공고_2026_57 = 837

const 목록 = [
  {
    파일: "ann-2026-57.hwpx",
    적용범위: "공고",
    announcement_id: 공고_2026_57,
    문서종류: "공고문",
    제목: "(제2026-57호) 2026년 지역혁신선도기업육성(R&D) 시행계획 공고",
    발행기관: "중소벤처기업부",
    버전: "제2026-57호",
    근거메모: "p.31 기관유형별 정부·지자체 지원연구개발비 비율표",
    mime: "application/haansofthwp",
  },
  {
    파일: "ann-2026-57-notice.hwp",
    적용범위: "공고",
    announcement_id: 공고_2026_57,
    문서종류: "신청 유의사항",
    제목: "(제2026-57호) [붙임3] (필독) 신청 방법 및 유의사항",
    발행기관: "중소벤처기업부",
    버전: "제2026-57호 붙임3",
    근거메모: "p.18 연구수당 수정인건비 20% 이내 · 간접비 직접비의 10% 이내 · 위탁 40% 이내",
    mime: "application/x-hwp",
  },
  {
    파일: "rule-06-mgmt-guideline.pdf",
    적용범위: "사업유형",
    사업유형: "NATIONAL_RND",
    문서종류: "관리지침",
    제목: "지역산업육성 기술개발사업 관리지침",
    발행기관: "중소벤처기업부",
    근거메모: "협약·변경·정산 절차의 근거",
    mime: "application/pdf",
  },
  {
    파일: "rule-07-cost-standard.pdf",
    적용범위: "사업유형",
    사업유형: "NATIONAL_RND",
    문서종류: "연구개발비 사용기준",
    제목: "국가연구개발사업 연구개발비 사용 기준",
    발행기관: "과학기술정보통신부",
    버전: "과기부고시 제2025-9호",
    근거메모: "비목별 사용 범위·불인정 항목의 근거",
    mime: "application/pdf",
  },
]

async function 이미있나(파일명) {
  const rows = await pgSelect("rule_documents", `파일명=eq.${encodeURIComponent(파일명)}&select=id`)
  return rows.length > 0
}

async function 올리기(path, buffer, contentType) {
  const safePath = path.split("/").map(encodeURIComponent).join("/")
  const res = await fetch(`${BASE}/storage/v1/object/${버킷}/${safePath}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  })
  if (!res.ok) throw new Error(`업로드 실패 ${res.status}: ${await res.text()}`)
}

let 등록 = 0
let 건너뜀 = 0

for (const d of 목록) {
  const 경로 = `${원문폴더}/${d.파일}`
  if (!existsSync(경로)) {
    console.log(`  ⚠ 없음 ${경로} — 건너뜀`)
    continue
  }
  if (await 이미있나(d.파일)) {
    console.log(`  · 이미 등록됨 ${d.파일}`)
    건너뜀++
    continue
  }

  const buf = readFileSync(경로)
  const ext = d.파일.split(".").pop()
  const 키 = d.적용범위 === "공고" ? `ann/ann-${d.announcement_id}` : `scheme/${d.사업유형}`
  const storage_path = `rules/${키}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  await 올리기(storage_path, buf, d.mime)
  await pgInsert("rule_documents", [
    {
      적용범위: d.적용범위,
      announcement_id: d.announcement_id ?? null,
      사업유형: d.사업유형 ?? null,
      문서종류: d.문서종류,
      제목: d.제목,
      발행기관: d.발행기관 ?? null,
      버전: d.버전 ?? null,
      근거메모: d.근거메모 ?? null,
      파일명: basename(d.파일),
      storage_path,
      크기: buf.length,
      mime: d.mime,
      // ⚠ 사람이 올린 게 아니라 스크립트가 심은 것이다. 업로더를 사람 이름으로 적지 않는다 —
      //   「누가 올렸는지」는 정산에서 가장 믿어야 하는 값이라 거짓을 넣으면 안 된다.
      업로더: "seed-rule-docs.mjs",
      업로더_인증: false,
    },
  ])
  console.log(`  ✓ ${d.적용범위} · ${d.문서종류} · ${d.파일} (${(buf.length / 1024).toFixed(0)}KB)`)
  등록++
}

console.log(`\n등록 ${등록}건 · 건너뜀 ${건너뜀}건`)
