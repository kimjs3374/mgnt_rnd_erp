"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { hashPassword } from "@/lib/password"

export type IssueTempPasswordResult =
  | { ok: true; tempPassword: string }
  | { ok: false; error: string }

export type ActionResult = { ok: true } | { ok: false; error: string }

// 등급: 슈퍼관리자 > 관리자 > 일반회원. 계정 관리(승인·권한부여·정지)는 슈퍼관리자만 만진다 —
// 관리자는 슈퍼관리자가 정해주는 등급일 뿐, 스스로 다른 사람을 관리자로 늘릴 수 없다.
async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user.인증 || user.role !== "super_admin") {
    throw new Error("슈퍼관리자 권한이 필요합니다.")
  }
  return user
}

export async function approveUser(formData: FormData): Promise<void> {
  const admin = await requireSuperAdmin()
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
  const admin = await requireSuperAdmin()
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
  await requireSuperAdmin()
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

/** status='approved'인 super_admin 수. excludeId를 주면 그 계정은 세지 않는다(그 계정을 바꾸는 중이라서). */
async function countActiveSuperAdmins(excludeId?: number): Promise<number> {
  let q = db
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("status", "approved")
  if (excludeId) q = q.neq("id", excludeId)
  const { count } = await q
  return count ?? 0
}

/**
 * 권한 부여/회수 — member ⇄ admin만 다룬다. 슈퍼관리자 등급은 이 화면에서 건드리지 않는다
 * (슈퍼관리자 지정·해제는 DB에서 직접 하는, 훨씬 무거운 조작으로 남겨둔다).
 * 바뀔 때마다 role_change_log에 남는다. 본인 권한은 스스로 못 바꾼다.
 */
export async function changeUserRole(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin()
  const id = Number(formData.get("id"))
  const newRole = String(formData.get("role") ?? "")
  if (!id || (newRole !== "member" && newRole !== "admin")) {
    return { ok: false, error: "잘못된 요청입니다." }
  }
  if (id === Number(admin.id)) {
    return { ok: false, error: "본인의 권한은 스스로 변경할 수 없습니다." }
  }

  const { data: target } = await db.from("users").select("role, status").eq("id", id).maybeSingle()
  if (!target) return { ok: false, error: "계정을 찾을 수 없습니다." }
  if (target.role === "super_admin") {
    return { ok: false, error: "슈퍼관리자의 권한은 이 화면에서 변경할 수 없습니다." }
  }
  if (target.role === newRole) return { ok: true }

  const { error } = await db.from("users").update({ role: newRole }).eq("id", id)
  if (error) {
    console.error("[admin-users] 권한 변경 실패:", error.message)
    return { ok: false, error: "권한 변경에 실패했습니다." }
  }

  await db.from("role_change_log").insert({
    user_id: id,
    old_role: target.role,
    new_role: newRole,
    changed_by: Number(admin.id),
  })

  revalidatePath("/admin/users")
  return { ok: true }
}

/** 계정 정지. 로그인 자체를 막는다(app/actions/auth.ts의 login()이 status==='suspended'를 거부). */
export async function suspendUser(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin()
  const id = Number(formData.get("id"))
  if (!id) return { ok: false, error: "잘못된 요청입니다." }
  if (id === Number(admin.id)) {
    return { ok: false, error: "본인 계정은 스스로 정지할 수 없습니다." }
  }

  const { data: target } = await db.from("users").select("role, status").eq("id", id).maybeSingle()
  if (!target) return { ok: false, error: "계정을 찾을 수 없습니다." }

  if (target.role === "super_admin" && target.status === "approved") {
    const remaining = await countActiveSuperAdmins(id)
    if (remaining === 0) {
      return { ok: false, error: "최소 한 명의 슈퍼관리자는 남아 있어야 합니다." }
    }
  }

  const { error } = await db.from("users").update({ status: "suspended" }).eq("id", id)
  if (error) {
    console.error("[admin-users] 계정 정지 실패:", error.message)
    return { ok: false, error: "계정 정지에 실패했습니다." }
  }

  revalidatePath("/admin/users")
  return { ok: true }
}

/** 정지 해제 — approved로 되돌린다. */
export async function reactivateUser(formData: FormData): Promise<ActionResult> {
  await requireSuperAdmin()
  const id = Number(formData.get("id"))
  if (!id) return { ok: false, error: "잘못된 요청입니다." }

  const { error } = await db.from("users").update({ status: "approved" }).eq("id", id)
  if (error) {
    console.error("[admin-users] 정지 해제 실패:", error.message)
    return { ok: false, error: "정지 해제에 실패했습니다." }
  }

  revalidatePath("/admin/users")
  return { ok: true }
}
