#!/usr/bin/env node
// K-Startup(창업진흥원) 공식 오픈API 수집 — 지원사업 > 공고 탐색.
//   https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01
//   서비스설계서 v2.0 (05. 필요API/[가이드]창업진흥원_K-Startup…) · 데이터 갱신주기 일 1회
//
// 기업마당과 달리 **지역(supt_regin)·접수일자를 정제된 필드로 그대로 준다.**
// 그래서 사업명 태그를 파싱할 필요가 없고, 첨부파일 경로도 안 주므로 정밀 파싱 단계가 없다 —
// 목록 수집 하나로 끝난다. 공고 본문(pbanc_ctnt)은 요약 컬럼에 그대로 남긴다.
//
// 매핑은 lib/sources.mjs 의 케이스타트업행() 한 곳에 있다 — 웹앱의 동기화 버튼
// (app/actions/announcements.ts)과 이 스크립트가 같은 함수를 쓴다. 복사본을 만들지 않는다.
//
// 사용: node scripts/collect-kstartup.mjs [최대 페이지, 기본 10]
import { pgUpsertByFilter, env } from "./lib/pgrest.mjs"
import { 케이스타트업행 } from "../lib/sources.mjs"

const BASE =
  "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01"
const PER_PAGE = 100

/**
 * ⚠ 인증키는 이미 URL 인코딩된 문자열이다(끝이 %3D%3D = "=="). encodeURIComponent 를
 *   다시 걸면 %253D 가 되어 401 이 돌아온다. 그대로 붙인다.
 */
async function fetchPage(page) {
  const url = `${BASE}?serviceKey=${env.KSTARTUP_API_KEY}&page=${page}&perPage=${PER_PAGE}&returnType=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  return j.data ?? []
}

async function main() {
  if (!env.KSTARTUP_API_KEY) {
    console.error("KSTARTUP_API_KEY 가 /web/rnd/.env.local 에 없다.")
    process.exit(1)
  }
  const maxPage = process.argv[2] ? Number(process.argv[2]) : 10

  const 전체 = []
  for (let page = 1; page <= maxPage; page++) {
    let data
    try {
      data = await fetchPage(page)
    } catch (e) {
      // 중간 페이지가 실패하면 받은 데까지 살린다 — 공공 API 는 간헐적으로 5xx 를 낸다.
      console.error(`  ${page}페이지 실패: ${e.message}`)
      if (page === 1) process.exit(1)
      break
    }
    전체.push(...data)
    process.stdout.write(`${page}페이지 ${data.length}건 · 누적 ${전체.length}건\n`)
    if (data.length < PER_PAGE) break
  }

  const rows = 전체.map(케이스타트업행).filter((r) => r.출처_id && r.사업명)
  console.log(`--- 저장 ${rows.length}건 ---`)

  let 저장 = 0
  let 실패 = 0
  for (const row of rows) {
    const filter = `출처=eq.K-Startup&출처_id=eq.${encodeURIComponent(row.출처_id)}`
    try {
      // 목록 필드만 보낸다. 이미 있는 공고의 본문·파싱상태는 페이로드에 없어 그대로 남는다.
      await pgUpsertByFilter("announcements", filter, { ...row, 파싱상태: "목록만" })
      저장++
    } catch (e) {
      실패++
      console.error(`  [${row.출처_id}] ${row.사업명.slice(0, 30)} 저장 실패: ${e.message}`)
    }
  }

  const 지역별 = {}
  for (const r of rows) for (const g of r.지역코드 ?? ["미상"]) 지역별[g] = (지역별[g] ?? 0) + 1
  console.log(`저장 완료 — ${저장}건 (실패 ${실패}건)`)
  console.log(
    "지역 분포: " +
      Object.entries(지역별)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
