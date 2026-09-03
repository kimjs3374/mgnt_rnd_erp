import "server-only"

/**
 * 자체 세션 — Supabase Auth 미사용. 서버가 HMAC-SHA256 으로 서명한 쿠키 하나로 로그인 상태를 증명한다.
 *
 * ⚠ Web Crypto API(`crypto.subtle`)로 짰다. `node:crypto` 가 아니다 —
 *   이 파일은 middleware.ts 에서도 import 되는데, Next.js 미들웨어는 기본적으로
 *   Edge 런타임이라 `node:crypto` 를 못 쓴다. `crypto.subtle` 은 Edge·Node 양쪽에서 다 된다.
 */

const SECRET = process.env.SESSION_SECRET
if (!SECRET) {
  throw new Error("SESSION_SECRET이 없다. /web/rnd/.env.local을 확인할 것.")
}

export const SESSION_COOKIE = "rnd_session"
export const SESSION_MAX_AGE = 60 * 60 * 12 // 12시간(초)

export type SessionPayload = {
  uid: number
  username: string
  name: string
  role: "member" | "admin"
  iat: number
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let str = ""
  for (const b of arr) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  const str = atob(b64 + pad)
  const arr = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i)
  return arr
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

async function sign(body: string): Promise<string> {
  const key = await hmacKey()
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return toBase64Url(sig)
}

export async function createSessionCookie(user: {
  id: number
  username: string
  name: string
  role: "member" | "admin"
}): Promise<string> {
  const payload: SessionPayload = {
    uid: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
  }
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await sign(body)
  return `${body}.${sig}`
}

/** 상수 시간 비교 — 서명 검증에서 타이밍 사이드채널을 막는다. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySessionCookie(value: string | undefined | null): Promise<SessionPayload | null> {
  if (!value) return null
  const dot = value.lastIndexOf(".")
  if (dot < 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)

  const expected = await sign(body)
  if (!timingSafeEqualStr(sig, expected)) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionPayload
    if (Math.floor(Date.now() / 1000) - payload.iat > SESSION_MAX_AGE) return null
    return payload
  } catch {
    return null
  }
}
