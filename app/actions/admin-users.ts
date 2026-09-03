"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

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
