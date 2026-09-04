"use client"

import * as React from "react"
import { IdCard, ListChecks, Wallet } from "lucide-react"
import { Card } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveCompany, type SaveResult } from "@/app/actions/company"
import { parseCompanyDocument, type ParseResult } from "@/app/actions/company-parse"

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
  /** "money" — 원 단위 큰 숫자(매출액 등)에 천 단위 콤마를 붙여 보여준다. 서버는 이미
   *  콤마를 걷어내고 파싱한다(`app/actions/company.ts`의 `숫자()`) — 여기서만 표시를 고친다. */
  kind?: "number" | "money" | "date" | "list" | "check"
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
  {
    name: "사업자등록번호",
    label: "사업자등록번호",
    hint: "증빙 판독의 거래 방향을 여기서 확정한다(우리가 아닌 쪽이 거래처). 비면 「보류」",
  },
  { name: "대표자", label: "대표자", hint: "신청서 초안" },
  { name: "설립일", label: "설립일", hint: "업력 요건(창업 N년 이내)", kind: "date" },
]

const 대조: Field[] = [
  { name: "소재지", label: "소재지", hint: "사람이 읽는 주소", 대조에쓰임: true },
  {
    name: "지역코드",
    label: "지역코드",
    hint: "공고 지역과 대조하는 값. 쉼표로 여러 개. 예: 전남광주",
    kind: "list",
    대조에쓰임: true,
  },
  { name: "기업규모", label: "기업규모", hint: "중소기업 · 중견기업 · 소상공인", 대조에쓰임: true },
  {
    name: "지원대상_유형",
    label: "지원대상 유형",
    hint: "공고의 지원대상과 대조. 쉼표로 여러 개. 예: 중소기업",
    kind: "list",
    대조에쓰임: true,
  },
  {
    name: "업종명",
    label: "업종",
    hint: "LLM 1차 거르기에 쓰인다. 쉼표로 여러 개",
    kind: "list",
    대조에쓰임: true,
  },
  { name: "주요제품", label: "주요제품", hint: "LLM 1차 거르기에 쓰인다" },
  {
    name: "ksic_코드",
    label: "업종코드(KSIC)",
    hint: "사업자등록증에서 확인한 뒤에만 채운다. 쉼표로 여러 개",
    kind: "list",
  },
]

// ⚠ 매출을 재무 나머지(부채비율·R&D집약도 등)와 **다른 Section**으로 가른다
//   (2026-09-04 사용자 지시: "재무 부분에 매출액 구분해줘"). 매출액·매출증가율은
//   한 쌍(증가율이 매출액을 기준으로 계산되는 값)이라 같이 두고, 결산연도는
//   그 기준 연도라 매출 쪽에 붙인다 — "아래 수치가 뜻이 없다"던 안내가 원래
//   결산연도 바로 다음 줄이었던 흐름을 유지한다.
const 매출: Field[] = [
  {
    name: "결산연도",
    label: "결산연도",
    hint: "어느 해 기준인지. 없으면 아래 수치가 뜻이 없다",
    kind: "number",
  },
  { name: "매출액", label: "매출액(원)", hint: "표준 재무제표", kind: "money" },
  { name: "매출증가율", label: "매출증가율(%)", hint: "표준 재무제표", kind: "number" },
]

const 재무: Field[] = [
  { name: "부채비율", label: "부채비율(%)", hint: "표준 재무제표", kind: "number" },
  { name: "rnd_집약도", label: "R&D 집약도(%)", hint: "기술기업개요표", kind: "number" },
  { name: "종업원수", label: "종업원 수", hint: "4대보험 가입자명부", kind: "number" },
  {
    name: "기업부설연구소",
    label: "기업부설연구소 보유",
    hint: "연구소 인정서",
    kind: "check",
  },
  {
    name: "자본전액잠식",
    label: "자본전액잠식 해당",
    hint: "해당하면 대부분의 사업에서 신청 자격이 없다",
    kind: "check",
  },
]

function 값문자열(v: unknown): string {
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return ""
  return String(v)
}

const 콤마포맷 = (digits: string) => (digits === "" ? "" : Number(digits).toLocaleString("ko-KR"))
/** 앞에서부터 숫자를 `n`개 지난 자리. 콤마는 안 센다(components/money-input.tsx와 같은 방법). */
function 커서자리(글: string, 숫자개수: number): number {
  if (숫자개수 <= 0) return 0
  let 셈 = 0
  for (let i = 0; i < 글.length; i++) {
    if (글[i] >= "0" && 글[i] <= "9") {
      셈 += 1
      if (셈 === 숫자개수) return i + 1
    }
  }
  return 글.length
}
const 숫자수 = (s: string) => s.replace(/[^\d]/g, "").length

/**
 * 매출액 같은 큰 원 단위 칸 — **치는 즉시 천 단위 콤마**(2026-09-04 사용자 지적: "매출액에
 * 쉼표 구분이 없어서 보기 힘들다"). `components/money-input.tsx`와 같은 방법(콤마는
 * `<input type="number">`가 못 받으니 text + inputMode="numeric")이지만, 이 폼은 제어
 * 컴포넌트가 아니라 **네이티브 FormData 제출**이라 그 컴포넌트를 그대로 못 쓴다 — `name`을
 * 가진 채로 콤마 섞인 문자열을 그대로 제출한다. 서버(`app/actions/company.ts`의 `숫자()`)가
 * 이미 콤마를 걷어내고 파싱하니 별도 처리가 필요 없다.
 */
function MoneyField({
  id,
  name,
  defaultValue,
}: {
  id: string
  name: string
  defaultValue: string
}) {
  const [text, setText] = React.useState(() => 콤마포맷(defaultValue.replace(/[^\d]/g, "")))
  const ref = React.useRef<HTMLInputElement>(null)
  const 놓을자리 = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && 놓을자리.current != null && document.activeElement === el) {
      const p = Math.min(놓을자리.current, el.value.length)
      el.setSelectionRange(p, p)
    }
    놓을자리.current = null
  })

  return (
    <Input
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder="—"
      className="h-7 w-64 text-[14.3px]"
      onChange={(e) => {
        const el = e.target
        const raw = el.value
        const 커서앞숫자 = 숫자수(raw.slice(0, el.selectionStart ?? raw.length))
        const digits = raw.replace(/[^\d]/g, "")
        const 다음 = 콤마포맷(digits)
        setText(다음)
        놓을자리.current = 커서자리(다음, 커서앞숫자)
      }}
    />
  )
}

function Row({
  f,
  values,
  판독값,
  근거,
}: {
  f: Field
  values: CompanyValues
  /** 서류 판독으로 읽은 값. 있으면 그 값을 칸에 넣고 「서류에서 읽음」을 표시한다. */
  판독값?: Record<string, unknown>
  근거?: Record<string, string>
}) {
  const 읽음 = 판독값 != null && f.name in 판독값
  const v = 읽음
    ? (판독값![f.name] as CompanyValues[keyof CompanyValues])
    : values[f.name]
  const 이_근거 = 근거?.[f.name]
  const 기존 = values[f.name]
  // 서류가 읽은 값이 지금 저장된 값과 다르면 그것도 보여준다 — 덮어쓰기 전에 알아야 한다.
  const 바뀜 = 읽음 && 값문자열(기존) !== "" && 값문자열(기존) !== 값문자열(v)

  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-[14.3px] ${
        읽음 ? "bg-[var(--success)]/15" : ""
      }`}
    >
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
          // 판독 결과가 오면 key 가 바뀌어 defaultChecked 가 다시 먹는다.
          key={`${f.name}-${읽음 ? "ai" : "db"}-${String(v)}`}
          defaultChecked={v === true}
          className="size-4 accent-primary"
        />
      ) : f.kind === "money" ? (
        <MoneyField
          id={f.name}
          name={f.name}
          // key 를 안 주면 판독 결과가 바뀌어도 내부 state 가 안 바뀐다(위 number/date 칸과 같은 이유).
          key={`${f.name}-${읽음 ? "ai" : "db"}-${값문자열(v)}`}
          defaultValue={값문자열(v)}
        />
      ) : (
        <Input
          id={f.name}
          name={f.name}
          type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
          step={f.kind === "number" ? "any" : undefined}
          // ⚠ key 를 안 주면 defaultValue 가 안 바뀐다 — React 는 마운트할 때만 읽는다.
          //   판독 결과가 화면에 반영되지 않는 원인이 이것이다(에러도 안 난다).
          key={`${f.name}-${읽음 ? "ai" : "db"}-${값문자열(v)}`}
          defaultValue={값문자열(v)}
          placeholder="—"
          className="h-7 w-64 text-[14.3px]"
        />
      )}

      <span className="flex-1 text-xs text-muted-foreground">
        {읽음 ? (
          <>
            <span className="font-medium text-[var(--success-fg)]">서류에서 읽음</span>
            {바뀜 && (
              <span className="ml-1 text-[var(--warning-fg)]">
                · 기존 {값문자열(기존)} 에서 바뀜
              </span>
            )}
            {이_근거 && <span className="ml-1 italic">「{이_근거}」</span>}
          </>
        ) : (
          f.hint
        )}
      </span>
    </div>
  )
}

/**
 * 서류를 올려 프로필을 채운다.
 *
 * ⚠ 판독 결과를 **DB 에 바로 쓰지 않는다.** 폼 칸에만 채워 놓고 사람이 「저장」을 누른다 —
 *   이 값들로 신청 자격을 판정하기 때문이다. 모델이 매출액 단위를 한 자리 틀리면
 *   자격이 없는 공고에 계획서를 쓰게 된다. 항목이 열 개가 넘어 하나만 틀려도 판정이 뒤집힌다.
 *   서류함(app/actions/documents.ts)은 발급일 하나라 확신도가 높으면 자동 확정하지만
 *   여기는 그렇게 하지 않는다.
 *
 * 별도 <form> 이다. 프로필 저장 폼 안에 두면 파일 input 이 같이 제출되고
 * 판독 버튼이 프로필을 저장해 버린다.
 */
function ParseUploader({ onParsed }: { onParsed: (r: ParseResult) => void }) {
  const [state, action, pending] = React.useActionState<ParseResult | null, FormData>(
    parseCompanyDocument,
    null,
  )

  // 판독이 끝나면 부모에게 값을 올려보낸다.
  React.useEffect(() => {
    if (state?.ok) onParsed(state)
  }, [state, onParsed])

  return (
    <div className="rounded-lg border bg-card p-3">
      <h2 className="mb-1 text-sm font-semibold">서류로 채우기</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        사업자등록증 · 표준재무제표증명 · 중소기업확인서 · 기업부설연구소 인정서 등을 올리면
        읽어서 아래 칸을 채운다. <b>바로 저장되지 않는다</b> — 값을 확인하고 「저장」을 눌러야 한다.
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          className="h-7 max-w-[320px] text-[14.1px] file:mr-2 file:h-6 file:rounded-md file:border file:bg-background file:px-2 file:text-[14.1px]"
        />
        {/* ⚠ type="submit" 을 빼면 shadcn 기본값(type="button")이라 아무 반응이 없다. */}
        <Button type="submit" variant="outline" className="h-7 text-[14.1px]" disabled={pending}>
          {pending ? "판독 중… (20~40초)" : "올려서 판독"}
        </Button>
        <span className="text-xs text-muted-foreground">
          pdf · 이미지만 (hwp 는 서류함에서 보관)
        </span>
      </form>

      {state && (
        <div
          className={
            state.ok
              ? "mt-2 rounded-md border p-2 text-xs"
              : "mt-2 rounded-md border border-destructive/40 p-2 text-xs text-destructive"
          }
        >
          {state.message}
          {state.서류함등록 && (
            <span className="ml-1 text-muted-foreground">
              · 서류함의 「{state.서류함등록}」에도 등록했다
            </span>
          )}
        </div>
      )}
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
  const [판독, set판독] = React.useState<ParseResult | null>(null)

  const 판독값 = 판독?.값
  const 근거 = 판독?.근거

  // 판독으로 채워진 값까지 세어서 「아직 비었다」를 말한다 — 채워 놓고 경고하면 거짓말이 된다.
  const 대조미입력 = 대조.filter((f) => {
    if (!f.대조에쓰임) return false
    if (판독값 && f.name in 판독값) return false
    const v = values[f.name]
    return v == null || (Array.isArray(v) && v.length === 0)
  }).length

  const 행 = (f: Field) => (
    <Row key={f.name} f={f} values={values} 판독값={판독값} 근거={근거} />
  )

  return (
    <div className="flex flex-col gap-4">
      <ParseUploader onParsed={set판독} />

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="출처_문서" defaultValue={values.출처_문서 ?? ""} />

        {판독값 && (
          <p className="rounded-lg border bg-card p-3 text-[14.3px]">
            서류에서 읽은 <b>{Object.keys(판독값).length}개 항목</b>이 아래에 채워져 있다(초록 배경).
            <b className="text-[var(--warning-fg)]"> 아직 저장되지 않았다</b> — 값을 확인하고
            「저장」을 눌러야 DB 에 들어간다. 틀린 값은 그 자리에서 고치면 된다.
          </p>
        )}

        {대조미입력 > 0 && (
          <p className="rounded-lg border bg-card p-3 text-[14.3px] text-[var(--warning-fg)]">
            ● 표시 항목 {대조미입력}개가 비어 있다 — 공고 탐색이 그만큼 못 거른다.
          </p>
        )}

        <Section icon={IdCard} title="신원" desc="신청서 초안과 증빙 판독이 쓰는 값">
          {신원.map(행)}
        </Section>

        <Section
          icon={ListChecks}
          title="자격 대조"
          desc="● 표시가 공고 탐색의 「우리 회사 조건」이 실제로 대조하는 값이다"
        >
          {대조.map(행)}
        </Section>

        <Section
          icon={Wallet}
          title="매출"
          desc="공고의 매출 규모 요건과 대조된다. 결산연도가 없으면 아래 수치가 어느 해 것인지 알 수 없다"
        >
          {매출.map(행)}
        </Section>

        <Section
          icon={Wallet}
          title="재무 — 그 외"
          desc="부채비율 한도 등 매출 외 자격 요건과 대조된다. 모르면 비워 둔다 — 추측으로 채우면 자격이 없는 공고에 계획서를 쓰게 된다"
        >
          {재무.map(행)}
        </Section>

        <div className="flex items-center gap-3">
          {/* type="submit" 을 빼면 조용히 아무 일도 안 일어난다. */}
          <Button type="submit" className="h-7 text-[14.1px]" disabled={pending}>
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
    </div>
  )
}

function Section({
  title,
  desc,
  icon: Icon,
  children,
}: {
  title: string
  desc: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        {Icon && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-3" />
          </span>
        )}
        {title}
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">{desc}</p>
      <Card className="divide-y">{children}</Card>
    </div>
  )
}
