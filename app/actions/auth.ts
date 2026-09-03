"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { hashPassword, isPasswordStrongEnough, verifyPassword } from "@/lib/password"
import { createSessionCookie, SESSION_COOKIE, REMEMBER_SESSION_TTL_SEC } from "@/lib/session"
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit"

export type ActionResult = { ok: true } | { ok: false; error: string }
export type FindUsernameResult = { ok: true; masked: string } | { ok: false; error: string }

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/
const GENERIC_LOGIN_ERROR = "아이디 또는 비밀번호가 올바르지 않습니다."

type UserRow = {
  id: number
  username: string
  password_hash: string
  name: string
  role: "member" | "admin" | "super_admin"
  status: "pending" | "approved" | "rejected" | "suspended"
  department: "research" | "planning" | null
}

export async function login(formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!username || !password) {
    return { ok: false, error: "아이디와 비밀번호를 입력하세요." }
  }

  // 무차별 대입 방지 — 아이디 단위 + IP 단위 둘 다 본다.
  // 아이디 단위만 걸면 여러 아이디를 돌려가며 시도하는 걸 못 막고,
  // IP 단위만 걸면 같은 아이디를 노린 분산 시도를 못 막는다.
  const hdrs = await headers()
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const userKey = `login:user:${username.toLowerCase()}`
  const ipKey = `login:ip:${ip}`
  const TOO_MANY = "로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요."
  if (!checkRateLimit(userKey, 5, 10 * 60 * 1000)) {
    return { ok: false, error: TOO_MANY }
  }
  if (!checkRateLimit(ipKey, 20, 10 * 60 * 1000)) {
    return { ok: false, error: TOO_MANY }
  }

  const { data, error } = await db
    .from("users")
    .select("id, username, password_hash, name, role, status, department")
    .eq("username", username)
    .maybeSingle<UserRow>()

  // 아이디 존재 여부를 노출하지 않는다 — "그런 아이디 없음"과 "비밀번호 틀림"을 같은 메시지로 묶는다.
  if (error || !data || !verifyPassword(password, data.password_hash)) {
    return { ok: false, error: GENERIC_LOGIN_ERROR }
  }

  if (data.status === "pending") {
    return { ok: false, error: "관리자 승인 대기 중인 계정입니다." }
  }
  if (data.status === "rejected") {
    return { ok: false, error: "가입이 반려된 계정입니다. 관리자에게 문의하세요." }
  }
  if (data.status === "suspended") {
    return { ok: false, error: "정지된 계정입니다. 관리자에게 문의하세요." }
  }

  resetRateLimit(userKey)

  // 자동 로그인 체크 시에만 쿠키에 Max-Age를 준다 — 안 주면 브라우저를 닫을 때
  // 같이 지워지는 세션 쿠키가 된다(토큰 자체는 어느 쪽이든 12시간/30일로 만료된다).
  const remember = formData.get("remember") === "on"
  const cookie = await createSessionCookie(
    { id: data.id, username: data.username, name: data.name, role: data.role, department: data.department },
    { remember },
  )

  const jar = await cookies()
  jar.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: REMEMBER_SESSION_TTL_SEC } : {}),
  })

  // 로그인 시각 기록은 세션 발급 실패의 원인이 되면 안 되므로 실패해도 무시한다.
  await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", data.id)

  redirect("/dashboard")
}

export async function logout(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect("/login")
}

export async function signup(formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const phone = String(formData.get("phone") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const department = String(formData.get("department") ?? "").trim()

  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "아이디는 영문·숫자·_-만 사용해 3~20자로 입력하세요." }
  }
  if (!name) {
    return { ok: false, error: "이름을 입력하세요." }
  }
  if (!isPasswordStrongEnough(password)) {
    return {
      ok: false,
      error: "비밀번호는 8자 이상, 영문 대문자·소문자·숫자·특수문자 중 3종 이상을 조합하세요.",
    }
  }
  if (password !== passwordConfirm) {
    return { ok: false, error: "비밀번호가 일치하지 않습니다." }
  }
  if (department !== "research" && department !== "planning") {
    return { ok: false, error: "소속 부서를 선택하세요." }
  }

  const { data: existing } = await db.from("users").select("id").eq("username", username).maybeSingle()
  if (existing) {
    return { ok: false, error: "이미 사용 중인 아이디입니다." }
  }

  const { error } = await db.from("users").insert({
    username,
    password_hash: hashPassword(password),
    name,
    phone: phone || null,
    email: email || null,
    department,
  })
  if (error) {
    console.error("[auth] signup insert 실패:", error.message)
    return { ok: false, error: "가입 신청 처리 중 오류가 발생했습니다. 다시 시도해주세요." }
  }

  return { ok: true }
}

function maskUsername(username: string): string {
  if (username.length <= 2) return username[0] + "*".repeat(Math.max(username.length - 1, 1))
  return username.slice(0, 2) + "*".repeat(username.length - 2)
}

/** 아이디 찾기 — 이름 + (연락처 또는 이메일) 일치 시 마스킹된 아이디만 보여준다. */
export async function findUsername(formData: FormData): Promise<FindUsernameResult> {
  const name = String(formData.get("name") ?? "").trim()
  const contact = String(formData.get("contact") ?? "").trim()
  if (!name || !contact) {
    return { ok: false, error: "이름과 연락처(또는 이메일)를 입력하세요." }
  }

  // .or() 필터 문자열을 직접 조립하지 않는다 — 값에 특수문자가 섞이면 필터 구문이 깨질 수 있다.
  // 대신 두 번 나눠 조회한다.
  const byPhone = await db.from("users").select("username").eq("name", name).eq("phone", contact).maybeSingle()
  const byEmail =
    byPhone.data ?? (await db.from("users").select("username").eq("name", name).eq("email", contact).maybeSingle()).data

  if (!byEmail) {
    return { ok: false, error: "일치하는 계정을 찾을 수 없습니다." }
  }

  return { ok: true, masked: maskUsername(byEmail.username) }
}

/**
 * 비밀번호 찾기 — 이 프로젝트엔 이메일 발송 인프라가 없다(확인함).
 * 그래서 "임시 비밀번호 자동 발송"이 아니라 "재설정 요청 접수 → 관리자가 확인 후 발급"으로 간다.
 * 계정 존재 여부를 노출하지 않기 위해 일치 여부와 무관하게 항상 같은 성공 메시지를 돌려준다.
 */
export async function requestPasswordReset(formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  if (!username || !email) {
    return { ok: false, error: "아이디와 등록된 이메일을 입력하세요." }
  }

  await db
    .from("users")
    .update({ reset_requested_at: new Date().toISOString() })
    .eq("username", username)
    .eq("email", email)

  return { ok: true }
}
