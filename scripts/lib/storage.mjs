// Supabase Storage HTTP API — 공고문 원본 파일을 우리 버킷에도 복사해 둔다.
// 왜 우리 버킷에 또 저장하나: 기업마당·IRIS 원본 링크가 나중에 끊길 수 있다
// (실측: IRIS 는 마감 지난 공고가 목록 API 에서 빠져 재수집으로 못 받는다).
import { env } from "./pgrest.mjs"

const BASE = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
// ⚠ SUPABASE_URL(127.0.0.1:3600)은 서버 안에서만 닿는다. 브라우저가 열 공개 URL은
// rnd-api.mgnt.kr 로 만든다 — 같은 백엔드를 nginx가 그대로 내보낸다(실측: 두 경로가
// storage/v1/bucket 에 같은 응답을 준다).
const PUBLIC_BASE = "https://rnd-api.mgnt.kr"

function headers(extra = {}) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra }
}

/** 버킷이 없으면 만든다. 이미 있으면 조용히 넘어간다(멱등). */
export async function ensureBucket(bucket, { public: isPublic = true } = {}) {
  const res = await fetch(`${BASE}/storage/v1/bucket`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ id: bucket, name: bucket, public: isPublic }),
  })
  if (res.ok) return true
  const text = await res.text()
  if (/already exists|Duplicate/i.test(text)) return true
  throw new Error(`버킷 생성 실패 ${res.status}: ${text}`)
}

const CONTENT_TYPE = {
  pdf: "application/pdf",
  hwp: "application/x-hwp",
  hwpx: "application/haansofthwp",
}

export function contentTypeFor(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase()
  return CONTENT_TYPE[ext] ?? "application/octet-stream"
}

/**
 * 버킷에 올리고 공개 URL을 돌려준다. 경로가 겹치면 덮어쓴다(x-upsert) — 재수집이
 * 같은 공고를 다시 올릴 때 중복 파일이 쌓이지 않게 한다.
 */
export async function uploadFile(bucket, path, buffer, contentType) {
  const safePath = path.split("/").map(encodeURIComponent).join("/")
  const res = await fetch(`${BASE}/storage/v1/object/${bucket}/${safePath}`, {
    method: "POST",
    headers: headers({
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    }),
    body: buffer,
  })
  if (!res.ok) throw new Error(`업로드 실패 ${res.status}: ${await res.text()}`)
  return `${PUBLIC_BASE}/storage/v1/object/public/${bucket}/${safePath}`
}
