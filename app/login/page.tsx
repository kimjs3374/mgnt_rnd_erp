"use client"

import { useActionState, useState } from "react"
import { login, signup, type ActionResult } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: ActionResult | null = null

function LoginPanel() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    return (await login(formData)) ?? null
  }, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username">아이디</Label>
        <Input id="username" name="username" autoComplete="username" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">비밀번호</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full justify-center" size="lg" disabled={pending}>
        {pending ? "로그인 중..." : "로그인"}
      </Button>
    </form>
  )
}

function SignupPanel() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    return await signup(formData)
  }, initialState)

  if (state?.ok) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-medium">가입 신청이 접수됐습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">관리자 승인 후 로그인할 수 있습니다.</p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="s-username">아이디</Label>
        <Input id="s-username" name="username" autoComplete="username" required placeholder="영문·숫자 3~20자" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="s-password">비밀번호</Label>
          <Input id="s-password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-password2">비밀번호 확인</Label>
          <Input id="s-password2" name="passwordConfirm" type="password" autoComplete="new-password" required />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">8자 이상, 영문 대문자·소문자·숫자·특수문자 중 3종 이상</p>
      <div className="space-y-1.5">
        <Label htmlFor="s-name">이름</Label>
        <Input id="s-name" name="name" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="s-phone">연락처</Label>
          <Input id="s-phone" name="phone" placeholder="010-0000-0000" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-email">이메일</Label>
          <Input id="s-email" name="email" type="email" placeholder="example@mgnt.kr" />
        </div>
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full justify-center" size="lg" disabled={pending}>
        {pending ? "신청 중..." : "가입 신청하기"}
      </Button>
    </form>
  )
}

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "signup">("login")

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold">잔업제로</h1>
          <p className="text-sm text-muted-foreground">지원사업 관리</p>
        </div>

        <div className="mb-6 flex gap-4 border-b text-sm">
          <button
            type="button"
            onClick={() => setTab("login")}
            className={
              tab === "login"
                ? "border-b-2 border-primary pb-2 font-medium text-primary"
                : "pb-2 text-muted-foreground hover:text-foreground"
            }
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={
              tab === "signup"
                ? "border-b-2 border-primary pb-2 font-medium text-primary"
                : "pb-2 text-muted-foreground hover:text-foreground"
            }
          >
            계정 신청
          </button>
        </div>

        {tab === "login" ? <LoginPanel /> : <SignupPanel />}
      </div>
    </div>
  )
}
