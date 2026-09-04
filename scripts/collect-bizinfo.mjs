#!/usr/bin/env node
// 기업마당 공식 오픈API 수집 — 지원사업 > 공고 탐색 전용 (과제사업의 NTIS·IRIS와 출처를 섞지 않는다).
// 로직은 01. 사전준비/프로토타입/gongo.py(2026-08-21, 1,558건 수집·PDF/HWP 판독 검증됨)를 이식.
//
// 목록(제목+요약)은 한 번에 다 받되(API 호출 1회), 첨부 다운로드+서류판독(무거운 단계)은
// company_profile 대조로 걸러진 후보에게만 한다 — 수백 건을 전부 똑같이 파싱하지 않는다.
// 걸러지지 않은 나머지는 목록 필드만 저장한다(검색·필터엔 걸리고, 첨부는 안 받는다).
//
// 사용: node scripts/collect-bizinfo.mjs [정밀파싱 최대건수, 기본 20]
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { pgUpsertByFilter, pgSelect, pgInsert } from "./lib/pgrest.mjs"
import { extractText, findSections } from "./lib/extract.mjs"
import { extractDocuments, selectRelevant } from "./lib/llm.mjs"
import { uploadFile, contentTypeFor } from "./lib/storage.mjs"
import { 기업마당행, 태그제거 } from "../lib/sources.mjs"

function loadEnv(path = "/web/rnd/.env.local") {
  const env = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue
    const i = line.indexOf("=")
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}
const env = loadEnv()

const API = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"

async function fetchList(cnt = 300) {
  const url = `${API}?crtfcKey=${env.BIZINFO_API_KEY}&dataType=json&searchCnt=${cnt}`
  const res = await fetch(url)
  const j = await res.json()
  return j.jsonArray ?? []
}

async function downloadFile(url, name, workdir) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
  const buf = Buffer.from(await res.arrayBuffer())
  const stem = (name.replace(/\.[^.]+$/, "") || name).replace(/[^\w가-힣-]/g, "_").slice(0, 60)
  const ext = (name.split(".").pop() || "").toLowerCase()
  const dst = join(workdir, ext ? `${stem}.${ext}` : stem)
  writeFileSync(dst, buf)
  return dst
}

/**
 * 목록 필드 매핑은 lib/sources.mjs 의 기업마당행() 한 곳에 있다.
 *
 * ⚠ 전에는 이 파일과 app/actions/announcements.ts 에 같은 로직이 복사돼 있었고,
 *   그래서 **한쪽만 고쳐진 채로 굴러갔다** — 지역·지원분야·지원대상이 API 응답에 멀쩡히
 *   들어 있는데도 302건 내내 비어 있었던 원인이 이것이다. 복사본을 다시 만들지 않는다.
 *
 * 사업유형(funding_schemes 코드)만 여기서 null 로 둔다 — 오픈API 가 안 주는 값이라
 * 「미분류」가 정직한 상태다. 추측해서 채우지 않는다.
 */
function listingRow(rec) {
  return { ...기업마당행(rec), 사업유형: null }
}

/**
 * 회사 정보로 걸러진(관련 없어 보이는) 공고 — 목록 필드만 저장하고 첨부는 안 받는다.
 * 검색·필터에는 그대로 걸리되, 다음에 회사가 바뀌거나 사람이 직접 열어보면 그때 정밀 파싱하면 된다.
 * 이미 있는 공고는 건드리지 않는다 — 예전에 더 깊이 파싱됐을 수 있는 걸 「목록만」으로 되돌리지 않는다.
 */
async function saveListingOnly(rec) {
  const filter = `출처=eq.기업마당&출처_id=eq.${encodeURIComponent(rec.pblancId)}`
  const existing = await pgSelect("announcements", `${filter}&select=id&limit=1`)
  if (existing.length > 0) return "이미있음"
  await pgInsert("announcements", [{ ...listingRow(rec), 파싱상태: "목록만" }])
  return "목록추가"
}

/**
 * company_profile 한 줄 요약 — LLM 1차 거르기(selectRelevant)에 넘길 회사 소개.
 *
 * 업종·소재지·기업규모부터 넣는다. 공고가 대상을 가르는 축이 그것이기 때문이다 —
 * 재무 수치는 자격 「판정」에는 쓰이지만 「이 공고가 우리 것이냐」를 고르는 데는 거의 안 쓰인다.
 * 비어 있는 항목은 문장에서 아예 빼고 지어내지 않는다. 프로필이 통째로 비면 null 을
 * 돌려주고, 호출부가 「최신순 상위」로 대신 판단한다(조용히 전체를 걸러버리지 않는다).
 */
async function companyProfileText() {
  const rows = await pgSelect("company_profile", "order=결산연도.desc&limit=1")
  const c = rows[0]
  if (!c) return null
  const parts = [
    c.회사명 ?? null,
    c.업종명?.length ? `업종 ${c.업종명.join(" · ")}` : null,
    c.주요제품 ? `주요제품 ${c.주요제품}` : null,
    c.소재지 ? `소재지 ${c.소재지}` : null,
    c.기업규모 ?? null,
    c.ksic_코드?.length ? `업종코드(KSIC) ${c.ksic_코드.join(", ")}` : null,
    c.종업원수 != null ? `종업원 ${c.종업원수}명` : null,
    c.매출액 != null ? `매출액 약 ${Math.round(c.매출액 / 1e8)}억원` : null,
    c.기업부설연구소 ? "기업부설연구소 보유" : null,
    c.rnd_집약도 != null ? `R&D 집약도 ${c.rnd_집약도}%` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

async function processOne(rec, workdir) {
  const name = String(rec.printFileNm || "")
  const url = String(rec.printFlpthNm || "")

  const row = { ...listingRow(rec), 파싱상태: "수집완료" }

  let text = ""
  if (name && url) {
    try {
      const path = await downloadFile(url, name, workdir)
      const ext = await extractText(path)
      text = ext.text
      row.파싱상태 = text ? "파싱완료" : "파싱실패"
      // 원본(기업마당) 서버 링크가 나중에 끊길 수 있다 — 우리 버킷에도 사본을 남긴다.
      // 판독 자체는 실패해도(파싱실패) 파일은 받았으니 사본은 올린다.
      try {
        const buf = readFileSync(path)
        // ⚠ Supabase Storage 키는 한글·공백이 든 원본 파일명을 그대로 받지 않는다
        //   (실측: InvalidKey 400). 폴더·파일명 전부 ASCII 로 — 원래 파일명은
        //   공고문_파일명 컬럼에 이미 있으니 화면은 그쪽을 보여준다.
        const 확장자 = (name.split(".").pop() || "bin").toLowerCase()
        row.공고문_bucket_url = await uploadFile(
          "announcements",
          `bizinfo/${rec.pblancId}.${확장자}`,
          buf,
          contentTypeFor(name),
        )
      } catch (e) {
        console.error(`  [${rec.pblancId}] 버킷 업로드 실패: ${e.message}`)
      }
    } catch (e) {
      row.파싱상태 = "파싱실패"
      console.error(`  [${rec.pblancId}] 첨부 다운로드/추출 실패: ${e.message}`)
    }
  } else {
    row.파싱상태 = "첨부없음"
  }
  if (!text && rec.bsnsSumryCn) text = 태그제거(rec.bsnsSumryCn) // 첨부가 안 열리면 API 요약이라도 남긴다
  if (text) row.본문 = text.slice(0, 100000)

  const filter = `출처=eq.기업마당&출처_id=eq.${encodeURIComponent(rec.pblancId)}`
  const [saved] = await pgUpsertByFilter("announcements", filter, row)

  let docCount = 0
  if (text) {
    const sections = findSections(text)
    if (sections.length > 0 && saved?.id) {
      try {
        const existing = await pgSelect("ann_required_docs", `announcement_id=eq.${saved.id}&select=id&limit=1`)
        if (existing.length === 0) {
          const r = await extractDocuments(sections)
          if (r.ok && Array.isArray(r.docs)) {
            const docRows = r.docs.map((d) => ({
              announcement_id: saved.id,
              서류명: d.서류명,
              필수여부: d.구분 === "필수",
              구분: d.구분 ?? "확인필요",
              유효기간_문구: d.비고 ?? null,
              원문: d.근거문장,
              근거문장: d.근거문장,
              확인상태: "미확인",
            }))
            await pgInsert("ann_required_docs", docRows)
            docCount = docRows.length
          }
        }
      } catch (e) {
        console.error(`  [${rec.pblancId}] 요구서류 판독 실패: ${e.message}`)
      }
    }
  }

  return { 파싱상태: row.파싱상태, 문서건수: docCount }
}

async function main() {
  const maxCount = process.argv[2] ? Number(process.argv[2]) : 20
  const workdir = mkdtempSync(join(tmpdir(), "bizinfo-"))
  console.log(`작업 디렉터리: ${workdir}`)

  const list = await fetchList(300)
  console.log(`기업마당 목록 ${list.length}건 수신 (API 호출 1회, 다운로드는 아직 안 함)`)

  // 회사 정보로 1차 거르기 — 제목+요약만 보고 후보를 고른다. 첨부 다운로드·서류판독(무거운 단계)은
  // 여기서 걸러진 것만 받는다. 전부 다 정밀 파싱하면 회사와 무관한 공고에도 똑같이 시간을 쓴다.
  const company = await companyProfileText()
  let relevant
  if (!company) {
    console.log("company_profile 이 비어 있어 거르지 못한다 — 최신순 상위로 대신한다")
    relevant = list.slice(0, maxCount)
  } else {
    console.log(`회사 정보로 거르는 중... (${company})`)
    const candidates = list.map((rec) => ({ 사업명: rec.pblancNm, 요약: 태그제거(rec.bsnsSumryCn), rec }))
    const picked = await selectRelevant(company, candidates)
    if (!picked) {
      console.log("회사 정보 대조 실패(로그인·타임아웃 등) — 최신순 상위로 대신한다")
      relevant = list.slice(0, maxCount)
    } else {
      console.log(`${list.length}건 중 ${picked.length}건을 후보로 골랐다`)
      relevant = picked.map((p) => p.rec).slice(0, maxCount)
    }
  }
  const relevantIds = new Set(relevant.map((r) => r.pblancId))

  console.log(`--- 정밀 파싱 ${relevant.length}건 (첨부 다운로드 + 서류 판독) ---`)
  for (const rec of relevant) {
    process.stdout.write(`[${rec.pblancId}] ${String(rec.pblancNm).slice(0, 40)} ... `)
    try {
      const r = await processOne(rec, workdir)
      console.log(`${r.파싱상태} · 문서 ${r.문서건수}건`)
    } catch (e) {
      console.log(`실패: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  const rest = list.filter((rec) => !relevantIds.has(rec.pblancId))
  console.log(`--- 나머지 ${rest.length}건은 목록만 저장 (첨부 안 받음) ---`)
  let listed = 0
  for (const rec of rest) {
    try {
      if ((await saveListingOnly(rec)) === "목록추가") listed++
    } catch (e) {
      console.error(`  [${rec.pblancId}] 목록 저장 실패: ${e.message}`)
    }
  }
  console.log(`목록만 새로 저장: ${listed}건`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
