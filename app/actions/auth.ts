"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { hashPassword, isPasswordStrongEnough, verifyPassword } from "@/lib/password"
import { createSessionCookie, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session"

export type ActionResult = { ok: true } | { ok: false; error: string }

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/
const GENERIC_LOGIN_ERROR = "아이디 또는 비밀번호가 올바르지 않습니다."

type UserRow = {
  id: number
  username: string
  password_hash: string
  name: string
  role: "member" | "admin"
  status: "pending" | "approved" | "rejected"
}

export async function login(formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!username || !password) {
    return { ok: false, error: "아이디와 비밀번호를 입력하세요." }
  }

  const { data, error } = await db
    .from("users")
    .select("id, username, password_hash, name, role, status")
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

  const cookie = await createSessionCookie({
    id: data.id,
    username: data.username,
    name: data.name,
    role: data.role,
  })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
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
  })
  if (error) {
    console.error("[auth] signup insert 실패:", error.message)
    return { ok: false, error: "가입 신청 처리 중 오류가 발생했습니다. 다시 시도해주세요." }
  }

  return { ok: true }
}
