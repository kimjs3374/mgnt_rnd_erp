"use client"

import { useActionState, useEffect, useState } from "react"
import {
  login,
  signup,
  findUsername,
  requestPasswordReset,
  type ActionResult,
  type FindUsernameResult,
} from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: ActionResult | null = null
const initialFindState: FindUsernameResult | null = null
const REMEMBER_ID_KEY = "rnd_remember_username"

function LoginPanel() {
  // 아이디 저장은 서버가 알 필요 없는 순수 클라이언트 기능이라 localStorage로 처리한다.
  // 최초 SSR 렌더는 항상 빈 값이어야 하이드레이션이 안 어긋난다 — 그래서 useEffect에서
  // 읽은 뒤 key를 바꿔 Input을 다시 마운트시켜 defaultValue를 반영한다.
  const [savedUsername, setSavedUsername] = useState("")
  const [rememberId, setRememberId] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_ID_KEY)
    if (saved) {
      setSavedUsername(saved)
      setRememberId(true)
    }
  }, [])

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    const checked = formData.get("rememberId") === "on"
    const username = String(formData.get("username") ?? "")
    if (checked && username) {
      window.localStorage.setItem(REMEMBER_ID_KEY, username)
    } else {
      window.localStorage.removeItem(REMEMBER_ID_KEY)
    }
    return (await login(formData)) ?? null
  }, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username">아이디</Label>
        <Input
          key={savedUsername}
          id="username"
          name="username"
          autoComplete="username"
          required
          autoFocus
          defaultValue={savedUsername}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">비밀번호</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            name="rememberId"
            checked={rememberId}
            onChange={(e) => setRememberId(e.target.checked)}
            className="size-3.5 rounded border-input"
          />
          아이디 저장
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="remember" className="size-3.5 rounded border-input" />
          자동 로그인
        </label>
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

function FindUsernamePanel() {
  const [state, formAction, pending] = useActionState<FindUsernameResult | null, FormData>(
    async (_prev, formData) => (await findUsername(formData)) ?? null,
    initialFindState,
  )

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="f-name">이름</Label>
        <Input id="f-name" name="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-contact">연락처 또는 이메일</Label>
        <Input id="f-contact" name="contact" placeholder="010-0000-0000 또는 example@mgnt.kr" required />
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && (
        <p className="rounded-md bg-muted/60 p-3 text-sm">
          아이디: <span className="font-mono font-medium">{state.masked}</span>
        </p>
      )}
      <Button type="submit" className="w-full justify-center" size="lg" disabled={pending}>
        {pending ? "조회 중..." : "아이디 찾기"}
      </Button>
    </form>
  )
}

function ResetPasswordPanel() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    return await requestPasswordReset(formData)
  }, initialState)

  if (state?.ok) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-medium">요청이 접수됐습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          관리자 확인 후 새 비밀번호를 별도로 안내해 드립니다.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="r-username">아이디</Label>
        <Input id="r-username" name="username" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="r-email">등록된 이메일</Label>
        <Input id="r-email" name="email" type="email" placeholder="가입 시 등록한 이메일" required />
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full justify-center" size="lg" disabled={pending}>
        {pending ? "요청 중..." : "비밀번호 재설정 요청"}
      </Button>
    </form>
  )
}

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "signup" | "find-id" | "reset-pw">("login")

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold">잔업제로</h1>
          <p className="text-sm text-muted-foreground">지원사업 관리</p>
        </div>

        <div className="mb-6 flex gap-4 border-b text-sm">
          {(
            [
              ["login", "로그인"],
              ["signup", "계정 신청"],
              ["find-id", "아이디 찾기"],
              ["reset-pw", "비번 찾기"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "border-b-2 border-primary pb-2 font-medium text-primary"
                  : "pb-2 text-muted-foreground hover:text-foreground"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "login" && <LoginPanel />}
        {tab === "signup" && <SignupPanel />}
        {tab === "find-id" && <FindUsernamePanel />}
        {tab === "reset-pw" && <ResetPasswordPanel />}
      </div>
    </div>
  )
}
