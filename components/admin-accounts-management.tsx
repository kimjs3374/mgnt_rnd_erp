"use client"

import { useActionState, useState } from "react"
import {
  changeUserRole,
  changeUserDepartment,
  changeUserPosition,
  changeUserExtraMenus,
  suspendUser,
  reactivateUser,
  type ActionResult,
} from "@/app/actions/admin-users"
import { Button } from "@/components/ui/button"
import { formatKstDateTime } from "@/lib/kst"
import { DEPARTMENTS, DEPARTMENT_LABEL, POSITIONS_BY_DEPARTMENT, type Department } from "@/lib/positions"

export type Account = {
  id: number
  username: string
  name: string
  email: string | null
  phone: string | null
  role: "member" | "admin" | "super_admin"
  status: "approved" | "suspended"
  department: Department | null
  position: string | null
  extra_menus: ("research" | "planning")[] | null
  last_login_at: string | null
}

export type Stats = { total: number; active: number; inactive: number; pending: number }

const STATUS_LABEL: Record<Account["status"], string> = { approved: "정상", suspended: "정지됨" }
const ROLE_LABEL: Record<Account["role"], string> = {
  super_admin: "슈퍼관리자",
  admin: "관리자",
  member: "일반회원",
}
const EXTRA_MENU_LABEL: Record<"research" | "planning", string> = {
  research: "과제사업 · 과제 관리",
  planning: "지원사업",
}

type Bucket = Department | "super_admin"

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}

/**
 * 인원 하나의 상세 — 기본 정보 + 등급/상태 + 부서/직급 + 개인 추가 메뉴 권한.
 *
 * ⚠ 성공하면 onUpdate로 부모(AdminAccountsManagement)의 목록 상태를 바로 고친다
 *   (revalidatePath를 안 쓰는 이유는 admin-users.ts 주석과 같다 — 서버를 다시 안 물어도
 *   부모가 들고 있는 배열을 직접 고치면 왼쪽 부서 트리·인원수까지 전부 그 자리에서 맞는다).
 */
function PersonDetail({
  account,
  onUpdate,
}: {
  account: Account
  onUpdate: (id: number, patch: Partial<Account>) => void
}) {
  const isSuperAdmin = account.role === "super_admin"

  const [roleState, roleAction, rolePending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const nextRole = formData.get("role") as "member" | "admin"
      const result = (await changeUserRole(formData)) ?? null
      if (result?.ok) onUpdate(account.id, { role: nextRole })
      return result
    },
    null,
  )

  const [statusState, statusAction, statusPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const nextStatus = account.status === "suspended" ? "approved" : "suspended"
      const action = account.status === "suspended" ? reactivateUser : suspendUser
      const result = (await action(formData)) ?? null
      if (result?.ok) onUpdate(account.id, { status: nextStatus })
      return result
    },
    null,
  )

  const [deptState, deptAction, deptPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const next = String(formData.get("department") ?? "") as Department
      const result = (await changeUserDepartment(formData)) ?? null
      // 부서가 바뀌면 서버가 직급도 같이 정리한다(새 부서 목록에 없는 직급이면 비움) —
      // 화면도 안전하게 비워 둔다. 정확한 값은 다음 방문 때 서버에서 다시 온다.
      if (result?.ok) onUpdate(account.id, { department: next, position: null })
      return result
    },
    null,
  )

  const [posState, posAction, posPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const next = String(formData.get("position") ?? "")
      const result = (await changeUserPosition(formData)) ?? null
      if (result?.ok) onUpdate(account.id, { position: next })
      return result
    },
    null,
  )

  const [extraState, extraAction, extraPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const next = formData.getAll("extra_menus").map(String) as ("research" | "planning")[]
      const result = (await changeUserExtraMenus(formData)) ?? null
      if (result?.ok) onUpdate(account.id, { extra_menus: next })
      return result
    },
    null,
  )

  const positions = account.department ? POSITIONS_BY_DEPARTMENT[account.department] : []

  return (
    <div className="space-y-6 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-base font-semibold">
          {account.name} <span className="text-sm font-normal text-muted-foreground">({account.username})</span>
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">연락처</dt>
          <dd>{account.phone ?? "-"}</dd>
          <dt className="text-muted-foreground">이메일</dt>
          <dd>{account.email ?? "-"}</dd>
          <dt className="text-muted-foreground">최근 로그인</dt>
          <dd>{account.last_login_at ? formatKstDateTime(account.last_login_at) : "-"}</dd>
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t pt-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">부서</p>
          <form action={deptAction}>
            <input type="hidden" name="id" value={account.id} />
            <select
              key={`dept-${account.id}-${account.department}`}
              name="department"
              defaultValue={account.department ?? ""}
              disabled={deptPending}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none"
            >
              <option value="" disabled>
                미지정
              </option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABEL[d]}
                </option>
              ))}
            </select>
          </form>
          {deptState && !deptState.ok && <p className="text-xs text-destructive">{deptState.error}</p>}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">직급</p>
          <form action={posAction}>
            <input type="hidden" name="id" value={account.id} />
            <select
              key={`pos-${account.id}-${account.position}`}
              name="position"
              defaultValue={account.position ?? ""}
              disabled={posPending || !account.department}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none disabled:opacity-50"
            >
              <option value="" disabled>
                {account.department ? "미지정" : "부서를 먼저 지정"}
              </option>
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </form>
          {posState && !posState.ok && <p className="text-xs text-destructive">{posState.error}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t pt-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            등급 — 지금 <span className="font-medium text-foreground">{ROLE_LABEL[account.role]}</span>
          </p>
          {isSuperAdmin ? (
            <p className="text-xs text-muted-foreground">슈퍼관리자 등급은 여기서 변경할 수 없습니다.</p>
          ) : (
            <div>
              <form action={roleAction}>
                <input type="hidden" name="id" value={account.id} />
                <input type="hidden" name="role" value={account.role === "admin" ? "member" : "admin"} />
                <Button type="submit" size="sm" variant="outline" disabled={rolePending}>
                  {rolePending
                    ? "변경 중..."
                    : account.role === "admin"
                      ? "일반회원으로 변경"
                      : "관리자로 승격"}
                </Button>
              </form>
              {roleState && !roleState.ok && (
                <p className="mt-1 text-xs text-destructive">{roleState.error}</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            상태 — 지금 <span className="font-medium text-foreground">{STATUS_LABEL[account.status]}</span>
          </p>
          <div>
            <form action={statusAction}>
              <input type="hidden" name="id" value={account.id} />
              <Button
                type="submit"
                size="sm"
                variant={account.status === "suspended" ? "outline" : "destructive"}
                disabled={statusPending}
              >
                {statusPending ? "처리 중..." : account.status === "suspended" ? "정지 해제" : "계정 정지"}
              </Button>
            </form>
            {statusState && !statusState.ok && (
              <p className="mt-1 text-xs text-destructive">{statusState.error}</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground">
          개인 추가 메뉴 권한 — 부서 기본 범위 밖에서 이 사람에게만 추가로 열어줄 메뉴
        </p>
        {isSuperAdmin ? (
          <p className="mt-2 text-xs text-muted-foreground">슈퍼관리자는 이미 전체 메뉴에 접근합니다.</p>
        ) : (
          <form
            action={extraAction}
            onChange={(e) => e.currentTarget.requestSubmit()}
            className="mt-2 flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={account.id} />
            {(["research", "planning"] as const).map((menu) => (
              <label key={menu} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="extra_menus"
                  value={menu}
                  defaultChecked={(account.extra_menus ?? []).includes(menu)}
                  disabled={extraPending}
                  className="size-3.5 rounded border-input"
                />
                {EXTRA_MENU_LABEL[menu]}
              </label>
            ))}
          </form>
        )}
        {extraState && !extraState.ok && <p className="mt-1 text-xs text-destructive">{extraState.error}</p>}
      </div>
    </div>
  )
}

export function AdminAccountsManagement({
  accounts,
  stats,
  onUpdate,
}: {
  accounts: Account[]
  stats: Stats
  /** 상태를 부모(AdminUsersClient)가 들고 있다 — 계정 승인 탭에서 승인한 사람이
   * 여기 목록에도 새로고침 없이 나타나야 하기 때문이다. */
  onUpdate: (id: number, patch: Partial<Account>) => void
}) {
  const [bucket, setBucket] = useState<Bucket>("research")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const updateAccount = onUpdate

  const bucketList: { key: Bucket; label: string }[] = [
    ...DEPARTMENTS.map((d) => ({ key: d as Bucket, label: DEPARTMENT_LABEL[d] })),
    { key: "super_admin", label: "최고관리자" },
  ]

  const countFor = (key: Bucket) =>
    key === "super_admin"
      ? accounts.filter((a) => a.role === "super_admin").length
      : accounts.filter((a) => a.department === key).length

  const list =
    bucket === "super_admin"
      ? accounts.filter((a) => a.role === "super_admin")
      : accounts.filter((a) => a.department === bucket)

  const selected = accounts.find((a) => a.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="전체 인원" value={stats.total} />
        <StatCard label="활성 직원" value={stats.active} />
        <StatCard label="비활성/퇴사" value={stats.inactive} />
        <StatCard label="승인 대기" value={stats.pending} />
      </div>

      <div className="grid grid-cols-[140px_220px_1fr] gap-4">
        <div className="space-y-1 rounded-lg border bg-card p-2">
          {bucketList.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => {
                setBucket(b.key)
                setSelectedId(null)
              }}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                bucket === b.key
                  ? "bg-accent font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <span>{b.label}</span>
              <span className="text-xs">{countFor(b.key)}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1 rounded-lg border bg-card p-2">
          {list.length === 0 && (
            <p className="p-2 text-center text-xs text-muted-foreground">인원이 없습니다.</p>
          )}
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(a.id)}
              className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm ${
                selectedId === a.id ? "bg-accent" : "hover:bg-muted"
              }`}
            >
              <span className="font-medium">
                {a.name} <span className="font-normal text-muted-foreground">({a.username})</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {a.position ?? "직급 미지정"} · {STATUS_LABEL[a.status]}
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <PersonDetail account={selected} onUpdate={updateAccount} />
        ) : (
          <div className="flex items-center justify-center rounded-lg border bg-card p-8 text-sm text-muted-foreground">
            왼쪽에서 인원을 선택하세요.
          </div>
        )}
      </div>
    </div>
  )
}
