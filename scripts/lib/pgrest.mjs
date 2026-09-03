// PostgREST(app 스키마)에 대한 최소 REST 클라이언트.
// supabase-js 를 안 쓰는 이유: realtime 클라이언트가 Node 20 에서 ws 트랜스포트를
// 따로 요구해서 배치 스크립트 하나 돌리는 데 부담이 크다. fetch 로 충분하다.
import { readFileSync } from "node:fs"

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
const BASE = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Accept-Profile": "app",
    "Content-Profile": "app",
    "Content-Type": "application/json",
    ...extra,
  }
}

export { env }

/** 조건에 맞는 행을 읽는다. query 는 PostgREST 쿼리 문자열(예: "출처=eq.IRIS"). */
export async function pgSelect(table, query = "") {
  const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, { headers: headers() })
  if (!res.ok) throw new Error(`select ${table} ${res.status}: ${await res.text()}`)
  return res.json()
}

/**
 * table 에 유니크 제약이 없어(스키마를 더 건드리지 않으려고 안 걸었다) on_conflict 에
 * 기대지 않는다 — 직접 조회 후 있으면 PATCH, 없으면 POST 한다.
 */
export async function pgUpsertByFilter(table, filter, row) {
  const existing = await pgSelect(table, `${filter}&select=id&limit=1`)
  if (existing.length > 0) {
    return pgPatch(table, `${filter}`, row)
  }
  return pgInsert(table, [row])
}

export async function pgPatch(table, query, row) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  })
  if (!res.ok) throw new Error(`patch ${table} ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function pgInsert(table, rows) {
  const res = await fetch(`${BASE}/rest/v1/${table}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`insert ${table} ${res.status}: ${await res.text()}`)
  return res.json()
}
