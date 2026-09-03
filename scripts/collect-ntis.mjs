#!/usr/bin/env node
// NTIS(국가과학기술지식정보서비스) 국가R&D 과제검색 오픈API 수집.
//
// ⚠ 이건 "공고"(모집 공고) API 가 아니다. 실측(2026-09-03)과 공식 매뉴얼
// (한국과학기술정보연구원_국가R&D 과제검색(대국민용)_매뉴얼.20210208.pdf) 둘 다
// 확인됨 — 이 API 가 제공하는 오퍼레이션은 "project" 하나뿐이고 필드도 전부
// ProjectYear·ProjectPeriod(연구수행기간)·GovernmentFunds 같은 "이미 수행된/
// 수행중인 과제"의 메타정보다. 접수기간·마감일·공고문 URL 개념 자체가 없다.
//
// 그래서 여기서 만든 행은 마감유형='정보성'으로 두고 접수시작/접수종료는 채우지
// 않는다 — 지원 가능한 공고인 것처럼 보이면 거짓이다("날짜를 지어내지 않는다").
// 실제 신청 가능한 공고는 IRIS 쪽(collect-iris.mjs)에서만 온다.
//
// 사용: node scripts/collect-ntis.mjs [검색어] [최대건수]
import { readFileSync } from "node:fs"
import { pgUpsertByFilter } from "./lib/pgrest.mjs"

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

const URL_ = "https://www.ntis.go.kr/rndopen/openApi/public_project"

// 응답이 <span class="search_word"> 를 &lt;span...&gt; 로 이스케이프해서 준다
// (실측 2026-09-03) — 엔티티부터 풀고 나서 하이라이트 태그를 벗긴다.
function stripHighlight(s) {
  const unescaped = (s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
  return unescaped.replace(/<span class="search_word">/g, "").replace(/<\/span>/g, "")
}

// 중첩 태그를 정확히 파싱하지 않고, HIT 블록 안에서 특정 경로의 첫 등장만 뽑는다.
// 이 API 응답 구조에서 각 필드명이 HIT 하나당 한 번만 나온다는 걸 실측으로 확인했다.
function tag(block, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return m ? stripHighlight(m[1]).trim() || null : null
}
function nested(block, outer, inner) {
  const m = new RegExp(`<${outer}>([\\s\\S]*?)</${outer}>`).exec(block)
  return m ? tag(m[1], inner) : null
}

function parseHits(xml) {
  const hits = xml.match(/<HIT NO="\d+">[\s\S]*?<\/HIT>/g) || []
  return hits.map((h) => ({
    projectNumber: tag(h, "ProjectNumber"),
    title: nested(h, "ProjectTitle", "Korean"),
    ministry: nested(h, "Ministry", "Name"),
    manageAgency: nested(h, "ManageAgency", "Name"),
    researchAgency: nested(h, "ResearchAgency", "Name"),
    projectYear: tag(h, "ProjectYear"),
    periodStart: nested(h, "ProjectPeriod", "TotalStart"),
    periodEnd: nested(h, "ProjectPeriod", "TotalEnd"),
    goalTeaser: nested(h, "Goal", "Teaser") || nested(h, "Goal", "Full"),
  }))
}

async function fetchNtis(query, { displayCount = 20, addQuery = "" } = {}) {
  const params = new URLSearchParams({
    apprvKey: env.NTIS_APPRV_KEY,
    collection: "project",
    query,
    searchFd: "BI",
    displayCount: String(displayCount),
    startPosition: "1",
    searchRnkn: "DATE/DESC",
  })
  if (addQuery) params.set("addQuery", addQuery)
  const res = await fetch(`${URL_}?${params.toString()}`)
  const xml = await res.text()
  return parseHits(xml)
}

function toRow(h) {
  return {
    출처: "NTIS",
    출처_id: h.projectNumber,
    사업명: h.title,
    소관부처: h.ministry,
    전문기관: h.manageAgency,
    지역: null,
    접수시작: null, // 접수기간 개념 없음 — 지어내지 않는다
    접수종료: null,
    마감유형: "정보성", // 신청 가능한 공고가 아니라 참고용 과제 정보라는 뜻
    공고일: null,
    사업유형: "NATIONAL_RND",
    본문: h.goalTeaser ? h.goalTeaser.slice(0, 100000) : null,
    파싱상태: "수집완료",
  }
}

async function main() {
  const query = process.argv[2] || "연구개발"
  const maxCount = process.argv[3] ? Number(process.argv[3]) : 10
  // 최근 연도만 — 2016년 종료 과제 같은 옛 이력까지 끌어오면 "정보성"이어도 낡은
  // 데이터로 화면을 채우게 된다. 대회 시연 기준 최근 2개년으로 좁힌다.
  const currentYear = new Date().getFullYear()
  const hits = await fetchNtis(query, {
    displayCount: maxCount,
    addQuery: `PY=${currentYear - 1}/MORE`,
  })
  console.log(`검색어 "${query}" · ${hits.length}건 (기준년도 ${currentYear - 1} 이상)`)

  for (const h of hits) {
    if (!h.projectNumber || !h.title) continue
    const row = toRow(h)
    const filter = `출처=eq.NTIS&출처_id=eq.${encodeURIComponent(h.projectNumber)}`
    await pgUpsertByFilter("announcements", filter, row)
    console.log(`[${h.projectNumber}] ${h.title.slice(0, 50)} · ${h.ministry ?? "—"}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
