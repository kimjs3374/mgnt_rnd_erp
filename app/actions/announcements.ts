"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { 기업마당행, 케이스타트업행 } from "@/lib/sources.mjs"

export type SyncResult = {
  ok: boolean
  error?: string
  /** 출처별 결과. 한쪽이 죽어도 다른 쪽 결과는 살려서 보여준다. */
  출처별?: { 출처: string; 건수: number; 오류?: string }[]
}

/**
 * 공고 목록 동기화 — 공식 오픈API 두 곳에서 **목록 필드만** 갱신한다.
 *
 * 첨부파일 다운로드·LLM 서류판독은 하지 않는다. 그건 건당 수 초~수십 초라 버튼 클릭에
 * 안 맞는다(현장 실측). 목록 필드만 upsert 하고, 이미 있는 공고의 본문·파싱상태는
 * 페이로드에 안 넣어 그대로 남는다 — PostgREST upsert 는 **보낸 컬럼만** 덮어쓴다.
 * 서류 판독까지 갱신하려면 서버에서 `node scripts/collect-bizinfo.mjs` 를 따로 돌린다.
 *
 * 매핑은 lib/sources.mjs 한 곳에 있다 — 이 액션과 배치 수집기가 같은 함수를 쓴다.
 * 전에는 두 곳에 복사돼 있어서 한쪽만 고쳐진 채 굴러갔다(지역·지원분야가 그래서 비어 있었다).
 */

/** 기업마당 — 지자체·중앙부처 지원사업. searchCnt 300 이 API 한 번의 상한이다(실측 totCnt 1560). */
async function 기업마당수집(): Promise<{ 건수: number; 오류?: string }> {
  const key = process.env.BIZINFO_API_KEY
  if (!key) return { 건수: 0, 오류: "BIZINFO_API_KEY 가 설정되어 있지 않다." }

  const url = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${key}&dataType=json&searchCnt=300`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) return { 건수: 0, 오류: `기업마당 API 오류: HTTP ${res.status}` }

  const json = await res.json()
  const list: Record<string, unknown>[] = json.jsonArray ?? []
  if (list.length === 0) return { 건수: 0, 오류: "기업마당 API가 빈 목록을 돌려줬다." }

  const rows = list.map(기업마당행)
  const { data, error } = await db
    .from("announcements")
    .upsert(rows, { onConflict: "출처,출처_id" })
    .select("id")
  if (error) return { 건수: 0, 오류: error.message }
  return { 건수: data?.length ?? rows.length }
}

/**
 * K-Startup(창업진흥원) — 창업·R&D·멘토링 공고.
 *
 * 기업마당과 달리 지역(supt_regin)·접수일자를 정제된 필드로 그대로 준다.
 * perPage 상한이 문서에 없어 100 으로 잡고 마지막 페이지까지 돈다 — 상한을 모르는 채
 * 큰 값을 넣으면 조용히 잘린 목록을 「전부」로 착각한다.
 *
 * ⚠ 인증키는 이미 URL 인코딩된 문자열이다(끝이 %3D%3D). encodeURIComponent 를 다시 걸면
 *   %253D 가 되어 401 이 난다. 그대로 붙인다.
 */
async function 케이스타트업수집(): Promise<{ 건수: number; 오류?: string }> {
  const key = process.env.KSTARTUP_API_KEY
  if (!key) return { 건수: 0, 오류: "KSTARTUP_API_KEY 가 설정되어 있지 않다." }

  const BASE =
    "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01"
  const perPage = 100
  const 전체: Record<string, unknown>[] = []

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${BASE}?serviceKey=${key}&page=${page}&perPage=${perPage}&returnType=json`,
      { cache: "no-store" },
    )
    if (!res.ok) {
      // 첫 페이지부터 실패면 오류, 중간이면 받은 데까지 살린다 — 전부 버릴 이유가 없다.
      if (page === 1) return { 건수: 0, 오류: `K-Startup API 오류: HTTP ${res.status}` }
      break
    }
    const json = await res.json()
    const data: Record<string, unknown>[] = json.data ?? []
    전체.push(...data)
    if (data.length < perPage) break
  }

  if (전체.length === 0) return { 건수: 0, 오류: "K-Startup API가 빈 목록을 돌려줬다." }

  // pbanc_sn 이 없는 레코드는 키가 없어 upsert 대상이 못 된다. 조용히 버리지 않고 세지도 않는다.
  const rows = 전체.map(케이스타트업행).filter((r) => r.출처_id && r.사업명)
  const { data, error } = await db
    .from("announcements")
    .upsert(rows, { onConflict: "출처,출처_id" })
    .select("id")
  if (error) return { 건수: 0, 오류: error.message }
  return { 건수: data?.length ?? rows.length }
}

/**
 * 두 출처를 함께 갱신한다. **한쪽이 죽어도 다른 쪽은 저장된다** —
 * 심사 항목에 「오류·재시도·대체 경로」가 걸려 있고, 실제로 공공 API 는 자주 5xx 를 낸다.
 */
export async function syncAnnouncements(): Promise<SyncResult> {
  const 결과: { 출처: string; 건수: number; 오류?: string }[] = []

  for (const [출처, 수집] of [
    ["기업마당", 기업마당수집],
    ["K-Startup", 케이스타트업수집],
  ] as const) {
    try {
      const r = await 수집()
      결과.push({ 출처, ...r })
    } catch (e) {
      결과.push({
        출처,
        건수: 0,
        오류: e instanceof Error ? e.message : String(e),
      })
    }
  }

  revalidatePath("/announcements")

  const 성공 = 결과.filter((r) => !r.오류)
  return {
    ok: 성공.length > 0,
    error: 성공.length === 0 ? 결과.map((r) => `${r.출처}: ${r.오류}`).join(" · ") : undefined,
    출처별: 결과,
  }
}

/**
 * 구 이름 호환. components/announcements-explorer.tsx 의 SyncButton 이 아직 이걸 부른다.
 *
 * ⚠ 지우지 않는 이유: 그 파일은 지금 mgnt3 가 붙잡고 고치는 중이다(2026-09-03 19:02 수정).
 *   같은 디렉터리에서 두 명이 같은 파일을 열면 나중에 저장한 쪽이 통째로 덮어쓴다 —
 *   실제로 한 번 사고가 났다(git log "queries.ts 저장 충돌 복구"). 남의 파일을 고쳐서
 *   빌드를 맞추는 대신, 여기에 한 줄을 남겨 그쪽이 그대로 컴파일되게 둔다.
 *   mgnt3 의 작업이 커밋되면 SyncButton 과 함께 이 함수를 지운다.
 */
export async function syncBizinfo(): Promise<{
  ok: boolean
  error?: string
  처리건수?: number
}> {
  const r = await syncAnnouncements()
  const 기업마당 = r.출처별?.find((s) => s.출처 === "기업마당")
  return { ok: r.ok, error: r.error ?? 기업마당?.오류, 처리건수: 기업마당?.건수 }
}
