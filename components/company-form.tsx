"use client"

import * as React from "react"
import { Card } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveCompany, type SaveResult } from "@/app/actions/company"

export type CompanyValues = {
  결산연도: number | null
  회사명: string | null
  사업자등록번호: string | null
  대표자: string | null
  소재지: string | null
  지역코드: string[] | null
  기업규모: string | null
  업종명: string[] | null
  주요제품: string | null
  설립일: string | null
  지원대상_유형: string[] | null
  ksic_코드: string[] | null
  종업원수: number | null
  매출액: number | null
  매출증가율: number | null
  부채비율: number | null
  rnd_집약도: number | null
  기업부설연구소: boolean
  자본전액잠식: boolean
  출처_문서: string | null
}

type Field = {
  name: keyof CompanyValues
  label: string
  hint: string
  kind?: "number" | "date" | "list" | "check"
  /** 자격 대조에 실제로 쓰이는 값. 비면 공고를 못 거른다 — 화면에서 따로 표시한다. */
  대조에쓰임?: boolean
}

/**
 * 「무엇에 쓰이는 값인가」를 항목마다 적어 둔다.
 * 회사 프로필은 사람이 한 번 채우고 잊는 화면이라, 비워 두면 무엇이 망가지는지
 * 그 자리에서 안 보이면 영영 안 채워진다.
 */
const 신원: Field[] = [
  { name: "회사명", label: "회사명", hint: "화면·문서에 찍히는 이름" },
  { name: "사업자등록번호", label: "사업자등록번호", hint: "증빙 판독의 거래 방향을 여기서 확정한다(우리가 아닌 쪽이 거래처). 비면 「보류」" },
  { name: "대표자", label: "대표자", hint: "신청서 초안" },
  { name: "설립일", label: "설립일", hint: "업력 요건(창업 N년 이내)", kind: "date" },
]

const 대조: Field[] = [
  { name: "소재지", label: "소재지", hint: "사람이 읽는 주소", 대조에쓰임: true },
  { name: "지역코드", label: "지역코드", hint: "공고 지역과 대조하는 값. 쉼표로 여러 개. 예: 전남광주", kind: "list", 대조에쓰임: true },
  { name: "기업규모", label: "기업규모", hint: "중소기업 · 중견기업 · 소상공인", 대조에쓰임: true },
  { name: "지원대상_유형", label: "지원대상 유형", hint: "공고의 지원대상과 대조. 쉼표로 여러 개. 예: 중소기업", kind: "list", 대조에쓰임: true },
  { name: "업종명", label: "업종", hint: "LLM 1차 거르기에 쓰인다. 쉼표로 여러 개", kind: "list", 대조에쓰임: true },
  { name: "주요제품", label: "주요제품", hint: "LLM 1차 거르기에 쓰인다" },
  { name: "ksic_코드", label: "업종코드(KSIC)", hint: "사업자등록증에서 확인한 뒤에만 채운다. 쉼표로 여러 개", kind: "list" },
]

const 재무: Field[] = [
  { name: "결산연도", label: "결산연도", hint: "어느 해 기준인지. 없으면 아래 수치가 뜻이 없다", kind: "number" },
  { name: "매출액", label: "매출액(원)", hint: "표준 재무제표", kind: "number" },
  { name: "매출증가율", label: "매출증가율(%)", hint: "표준 재무제표", kind: "number" },
  { name: "부채비율", label: "부채비율(%)", hint: "표준 재무제표", kind: "number" },
  { name: "rnd_집약도", label: "R&D 집약도(%)", hint: "기술기업개요표", kind: "number" },
  { name: "종업원수", label: "종업원 수", hint: "4대보험 가입자명부", kind: "number" },
  { name: "기업부설연구소", label: "기업부설연구소 보유", hint: "연구소 인정서", kind: "check" },
  { name: "자본전액잠식", label: "자본전액잠식 해당", hint: "해당하면 대부분의 사업에서 신청 자격이 없다", kind: "check" },
]

function 값문자열(v: CompanyValues[keyof CompanyValues]): string {
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return ""
  return String(v)
}

function Row({ f, values }: { f: Field; values: CompanyValues }) {
  const v = values[f.name]

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
      <label htmlFor={f.name} className="w-44 shrink-0 text-muted-foreground">
        {f.label}
        {f.대조에쓰임 && (
          <span
            className="ml-1 text-[var(--warning-fg)]"
            title="공고 탐색의 「우리 회사 조건」이 이 값으로 거른다"
          >
            ●
          </span>
        )}
      </label>

      {f.kind === "check" ? (
        <input
          id={f.name}
          name={f.name}
          type="checkbox"
          defaultChecked={v === true}
          className="size-4 accent-primary"
        />
      ) : (
        <Input
          id={f.name}
          name={f.name}
          type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
          step={f.kind === "number" ? "any" : undefined}
          defaultValue={값문자열(v)}
          placeholder="—"
          className="h-7 w-64 text-[13px]"
        />
      )}

      <span className="flex-1 text-xs text-muted-foreground">{f.hint}</span>
    </div>
  )
}

/**
 * 회사 프로필 입력.
 *
 * ⚠ shadcn Button 은 기본이 type="button" 이다. 폼 안에서 type="submit" 을 명시하지 않으면
 *   **에러도 요청도 없이 아무 반응이 없다.** (CLAUDE.md §4.5-1 — 서버에서 실제로 걸린 함정)
 */
export function CompanyForm({ values }: { values: CompanyValues }) {
  const [state, action, pending] = React.useActionState<SaveResult | null, FormData>(
    saveCompany,
    null,
  )

  const 대조미입력 = [...대조].filter((f) => {
    const v = values[f.name]
    return f.대조에쓰임 && (v == null || (Array.isArray(v) && v.length === 0))
  }).length

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="출처_문서" defaultValue={values.출처_문서 ?? ""} />

      {대조미입력 > 0 && (
        <p className="rounded-lg border bg-card p-3 text-[13px] text-[var(--warning-fg)]">
          ● 표시 항목 {대조미입력}개가 비어 있다 — 공고 탐색이 그만큼 못 거른다.
        </p>
      )}

      <Section title="신원" desc="신청서 초안과 증빙 판독이 쓰는 값">
        {신원.map((f) => (
          <Row key={f.name} f={f} values={values} />
        ))}
      </Section>

      <Section
        title="자격 대조"
        desc="● 표시가 공고 탐색의 「우리 회사 조건」이 실제로 대조하는 값이다"
      >
        {대조.map((f) => (
          <Row key={f.name} f={f} values={values} />
        ))}
      </Section>

      <Section
        title="재무"
        desc="공고의 자격 요건(매출 규모·부채비율 한도 등)과 대조된다. 모르면 비워 둔다 — 추측으로 채우면 자격이 없는 공고에 계획서를 쓰게 된다"
      >
        {재무.map((f) => (
          <Row key={f.name} f={f} values={values} />
        ))}
      </Section>

      <div className="flex items-center gap-3">
        {/* type="submit" 을 빼면 조용히 아무 일도 안 일어난다. */}
        <Button type="submit" className="h-7 text-[12.8px]" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
        {state && (
          <span
            className={
              state.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"
            }
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  )
}

function Section({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <p className="mb-2 text-xs text-muted-foreground">{desc}</p>
      <Card className="divide-y">{children}</Card>
    </div>
  )
}
