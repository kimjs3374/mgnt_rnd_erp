"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { hashPassword } from "@/lib/password"

export type IssueTempPasswordResult =
  | { ok: true; tempPassword: string }
  | { ok: false; error: string }

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user.인증 || user.role !== "admin") {
    throw new Error("관리자 권한이 필요합니다.")
  }
  return user
}

export async function approveUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const id = Number(formData.get("id"))
  if (!id) return

  await db
    .from("users")
    .update({
      status: "approved",
      approved_by: Number(admin.id),
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)

  revalidatePath("/admin/users")
}

export async function rejectUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const id = Number(formData.get("id"))
  if (!id) return

  await db
    .from("users")
    .update({
      status: "rejected",
      approved_by: Number(admin.id),
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)

  revalidatePath("/admin/users")
}

function generateTempPassword(): string {
  // 사람이 옮겨 적기 헷갈리는 문자(0/O, 1/l/I)를 뺀다.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  let pw = ""
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw + "!7" // 특수문자·숫자 보장 — isPasswordStrongEnough 기준을 항상 만족시킨다
}

/**
 * 비밀번호 재설정 요청을 처리한다 — 임시 비밀번호를 새로 발급하고 딱 한 번 화면에 보여준다.
 * 어디에도 저장하지 않는다(해시만 DB에 남는다). 관리자가 본인에게 직접 전달해야 한다.
 */
export async function issueTempPassword(formData: FormData): Promise<IssueTempPasswordResult> {
  await requireAdmin()
  const id = Number(formData.get("id"))
  if (!id) return { ok: false, error: "잘못된 요청입니다." }

  const tempPassword = generateTempPassword()
  const { error } = await db
    .from("users")
    .update({ password_hash: hashPassword(tempPassword), reset_requested_at: null })
    .eq("id", id)

  if (error) {
    console.error("[admin-users] 임시 비밀번호 발급 실패:", error.message)
    return { ok: false, error: "임시 비밀번호 발급에 실패했습니다." }
  }

  // ⚠ 여기서 revalidatePath 를 부르지 않는다 — 부르면 서버가 목록을 다시 읽어 이 행이
  //   즉시 사라지고(더 이상 reset_requested_at IS NOT NULL 이 아니므로) 방금 발급한
  //   비밀번호를 admin이 읽기도 전에 화면에서 지워진다(실측: 12초 대기해도 못 읽음).
  //   다음에 페이지를 새로 열면 어차피 빠져 있으니 revalidate가 없어도 데이터는 정확하다.
  return { ok: true, tempPassword }
}
