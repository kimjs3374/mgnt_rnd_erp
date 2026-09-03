#!/usr/bin/env node
// IRIS(범부처통합연구지원시스템) 공고 수집 → 텍스트 추출 → 제출서류 판독.
//
// 2026-09-03 심사위원 확인: 공개된 공고문 크롤링 허용(대회 규칙 재확인 완료).
// 대상은 www.iris.go.kr 상세페이지·첨부파일뿐이다 — 그 밖으로 나가지 않는다.
// 로직은 01. 사전준비/프로토타입/iris.py(2026-08-21, 5건 end-to-end 검증됨)를 그대로 이식.
//
// 사용: node scripts/collect-iris.mjs [최대건수]
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pgSelect, pgUpsertByFilter, pgInsert } from "./lib/pgrest.mjs"
import { extractText, findSections } from "./lib/extract.mjs"
import { extractDocuments } from "./lib/llm.mjs"

const BASE = "https://www.iris.go.kr"
const LIST_URL = BASE + "/contents/retrieveMainPageBsnsAncmList.do"
const VIEW_URL = BASE + "/contents/retrieveBsnsAncmView.do"
const FILE_URL = BASE + "/comm/file/fileDownload.do"
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Referer: BASE + "/main.do" }
const FILE_RE = /f_bsnsAncm_downloadAtchFile\('([^']*)','([^']*)','([^']*)'\s*,'(\d+)'\)/g
const TEST_PAT = /\(TEST\)|테스트\s*입니다/

async function fetchList(page = 1) {
  const body = new URLSearchParams({ pageIndex: String(page), ancmPrg: "" })
  const res = await fetch(LIST_URL, {
    method: "POST",
    headers: { ...UA, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  const j = await res.json()
  const info = j.bsnsAncmPaginationInfo
  return { list: j.listBsnsAncm, pages: info.totalPageCount }
}

async function fetchAll(maxPages) {
  let out = []
  let page = 1
  while (true) {
    const { list, pages } = await fetchList(page)
    out = out.concat(list)
    if (page >= pages || (maxPages && page >= maxPages)) break
    page += 1
    await new Promise((r) => setTimeout(r, 600))
  }
  return out.filter((r) => !TEST_PAT.test(r.ancmTl || ""))
}

async function fetchDetail(ancmId) {
  const res = await fetch(`${VIEW_URL}?ancmId=${encodeURIComponent(ancmId)}`, { headers: UA })
  const html = await res.text()
  const files = [...html.matchAll(FILE_RE)].map((m) => ({
    doc_id: m[1], file_id: m[2], name: m[3], size: Number(m[4]),
  }))
  return { files }
}

// 본공고문을 고른다. "붙임" 접두 없이 "공고"가 들어간 걸 우선한다 —
// 실측(2026-09-03)에서 붙임 파일이 먼저 나오고 정작 본공고문이 마지막인 사례가 있었다.
function pickNotice(files) {
  const cands = files.filter((f) => /\.(hwp|hwpx|pdf)$/i.test(f.name))
  const primary = cands.find((f) => f.name.includes("공고") && !f.name.startsWith("붙임"))
  return primary ?? cands[0] ?? null
}

async function downloadFile(f, workdir) {
  const url = `${FILE_URL}?atchDocId=${encodeURIComponent(f.doc_id)}&atchFileId=${encodeURIComponent(f.file_id)}`
  const res = await fetch(url, { headers: UA })
  const buf = Buffer.from(await res.arrayBuffer())
  const stem = (f.name.replace(/\.[^.]+$/, "") || f.name).replace(/[^\w가-힣-]/g, "_").slice(0, 60)
  const ext = (f.name.split(".").pop() || "").toLowerCase()
  const dst = join(workdir, ext ? `${stem}.${ext}` : stem)
  writeFileSync(dst, buf)
  return dst
}

function parsePeriod(rec) {
  const norm = (s) => (s || "").replaceAll(".", "-")
  return { start: rec.rcveStrDe ? norm(rec.rcveStrDe) : null, end: rec.rcveEndDe ? norm(rec.rcveEndDe) : null }
}

async function processOne(rec, workdir) {
  const { files } = await fetchDetail(rec.ancmId)
  const notice = pickNotice(files)
  const period = parsePeriod(rec)

  const row = {
    출처: "IRIS",
    출처_id: rec.ancmId,
    사업명: rec.ancmTl,
    소관부처: rec.blngGovdSeNm ?? null,
    전문기관: rec.sorgnNm ?? null,
    지역: null, // IRIS 는 전국 단위 범부처 R&D 라 지역 개념이 없다. 지어내지 않는다.
    접수시작: period.start,
    접수종료: period.end,
    마감유형: period.start && period.end ? "dated" : "미상",
    공고일: rec.ancmDe ?? null,
    사업유형: "NATIONAL_RND",
    공고문_파일명: notice?.name ?? null,
    파싱상태: "수집완료",
  }

  let text = ""
  if (notice) {
    try {
      const path = await downloadFile(notice, workdir)
      const ext = await extractText(path)
      text = ext.text
      row.파싱상태 = text ? "파싱완료" : "파싱실패"
    } catch (e) {
      row.파싱상태 = "파싱실패"
      // announcements 에는 비고 컬럼이 없다(스키마를 더 넓히지 않는다) — 콘솔에만 남긴다.
      console.error(`  [${rec.ancmId}] 첨부 다운로드/추출 실패: ${e.message}`)
    }
  } else {
    row.파싱상태 = "첨부없음"
  }
  if (text) row.본문 = text.slice(0, 100000) // 컬럼 폭주 방지. 원문은 필요하면 재수집한다.

  const filter = `출처=eq.IRIS&출처_id=eq.${encodeURIComponent(rec.ancmId)}`
  const [saved] = await pgUpsertByFilter("announcements", filter, row)

  // 요구서류 추출은 별도 실패 지점이다 — ann_required_docs 테이블 부재·LLM 미로그인 등으로
  // 여기서 죽어도 이미 저장한 announcements 행은 그대로 살아 있어야 한다.
  let docsResult = null
  if (text) {
    const sections = findSections(text)
    // ⚠ 이미 판독한 공고는 LLM 을 다시 부르지 않는다. 이 검사가 extractDocuments 뒤에
    //   있으면, 재수집할 때마다 결과를 버릴 행까지 헤드리스로 부른다(호출당 약 4만 토큰).
    //   ⚠ 실제 테이블은 공고_id 가 아니라 announcement_id 다(2026-09-02 초기 시드,
    //   db/*.sql 에는 CREATE 문이 없어 처음엔 없는 줄 알고 새로 만들려 했었다).
    const existing = saved?.id
      ? await pgSelect("ann_required_docs", `announcement_id=eq.${saved.id}&select=id&limit=1`)
      : []
    if (sections.length > 0 && existing.length === 0) {
      try {
        const r = extractDocuments(sections)
        docsResult = r
        if (r.ok && Array.isArray(r.docs) && saved?.id) {
          // 필수여부(boolean)는 기존 컬럼 그대로 두고, 구분(text, 4분류)을 병행해 채운다.
          {
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
          }
        }
      } catch (e) {
        docsResult = { ok: false, error: e.message }
      }
    }
  }

  return { id: saved?.id, 파싱상태: row.파싱상태, 문서건수: docsResult?.docs?.length ?? 0, llm_ok: docsResult?.ok ?? null }
}

async function main() {
  const maxCount = process.argv[2] ? Number(process.argv[2]) : 5
  const workdir = mkdtempSync(join(tmpdir(), "iris-"))
  console.log(`작업 디렉터리: ${workdir}`)

  // 접수 진행중 전부를 본다. 전에는 1페이지(9건)에서 끊겨 IRIS 가 NTIS 참고자료보다
  // 적었다 — 본체가 참고보다 적으면 화면이 거짓말을 한다. 실측 2026-09-03: 총 15건 / 2페이지.
  // 건수는 maxCount 로 막는다. 여기서 막지 않는다.
  const list = await fetchAll()
  console.log(`접수 진행중 ${list.length}건 중 ${Math.min(maxCount, list.length)}건 처리`)

  for (const rec of list.slice(0, maxCount)) {
    process.stdout.write(`[${rec.ancmId}] ${rec.ancmTl.slice(0, 40)} ... `)
    try {
      const r = await processOne(rec, workdir)
      console.log(`${r.파싱상태} · 문서 ${r.문서건수}건${r.llm_ok === false ? " (LLM 미실행)" : ""}`)
    } catch (e) {
      console.log(`실패: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
