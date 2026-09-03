import { Card, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import type { EngineReport } from "@/lib/queries-engine"

/**
 * 판정 리포트 — **엔진이 무엇을 어떻게 걸렀는지**를 숫자와 막대로 보여준다.
 *
 * 사용자 요청(2026-09-04): "api로 받아온 raw데이터 대비해서 엔진의 어떤 로직을 기반으로
 * 제외했고 어떻게 이렇게 데이터들이 산출되는지 시각적으로 볼수있고 정량적인 데이터
 * 기반으로 확인할 수 있는 페이지".
 *
 * 그리는 원칙 — 라이브러리를 쓰지 않는다(CLAUDE.md 스택 고정). 막대는 div 너비다.
 * 숫자는 전부 DB 에서 센 것이고, 어느 게이트가 몇 건을 걸렀는지는 ann_rule_scores 의
 * 게이트_결과에 실제로 적혀 있는 값이다 — 여기서 새로 계산하거나 추정하지 않는다.
 */

function 퍼센트(n: number, 전체: number): string {
  if (!전체) return "0%"
  return `${((n / 전체) * 100).toFixed(1)}%`
}

/** 막대 하나. 라이브러리 없이 폭으로만 그린다. */
function Bar({ 값, 최대, 색 }: { 값: number; 최대: number; 색: string }) {
  const w = 최대 > 0 ? Math.max(1.5, (값 / 최대) * 100) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: 색 }} />
    </div>
  )
}

export function EngineReportView({ report }: { report: EngineReport }) {
  if (report.error) {
    return (
      <>
        <DbError what="판정 리포트" error={report.error} />
        <Card>
          <EmptyState
            title="아직 규칙 엔진 판정 기록이 없다"
            hint="서버에서 bot/ann_rules.py 배치를 돌리면 이 화면이 채워진다."
          />
        </Card>
      </>
    )
  }

  const 전체 = report.수집.전체
  const 판정합 = report.판정분포.reduce((n, r) => n + r.건수, 0)
  const 자동제외 =
    (report.판정분포.find((r) => r.판정 === "불가")?.건수 ?? 0) +
    (report.판정분포.find((r) => r.판정 === "해당없음")?.건수 ?? 0) +
    (report.퍼널.find((f) => f.이름 === "접수 마감 제외")?.건수 ?? 0)
  const 사람이볼것 =
    (report.판정분포.find((r) => r.판정 === "확인필요")?.건수 ?? 0) +
    (report.판정분포.find((r) => r.판정 === "가능")?.건수 ?? 0)

  return (
    <div className="grid gap-4">
      {/* ── 요약 ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { 라벨: "API 수집 원본", 값: 전체.toLocaleString(), 곁: `${report.수집.출처별.length}개 출처` },
          { 라벨: "엔진이 자동 제외", 값: 자동제외.toLocaleString(),
            곁: `전체의 ${퍼센트(자동제외, 전체)} — 마감·불가·해당없음` },
          { 라벨: "사람이 볼 것", 값: 사람이볼것.toLocaleString(),
            곁: `가능 + 확인필요 (${퍼센트(사람이볼것, 전체)})` },
          { 라벨: "LLM 호출", 값: report.llm_호출.toLocaleString() + "회",
            곁: `규칙 엔진 ${report.엔진버전} · 전부 계산으로 판정` },
        ].map((s) => (
          <div key={s.라벨} className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground">{s.라벨}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{s.값}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{s.곁}</div>
          </div>
        ))}
      </div>

      {/* ── 소거 퍼널 ────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold">수집 원본에서 여기까지 — 어디서 얼마나 빠졌나</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          각 줄은 <b>그 단계에서 빠진 건수</b>다. 위에서 아래로 순서대로 적용된다.
        </p>
        <div className="grid gap-2.5">
          {report.퍼널.map((f) => (
            <div key={f.이름} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{f.이름}</span>
                <span className="shrink-0 text-[13px] tabular-nums">
                  <b>{f.건수.toLocaleString()}</b>
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {퍼센트(f.건수, 전체)}
                  </span>
                </span>
              </div>
              <Bar 값={f.건수} 최대={전체} 색={f.색} />
              <p className="text-[11px] text-muted-foreground">{f.설명}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 게이트별 ─────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold">어떤 규칙이 몇 건을 걸렀나</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          엔진 {report.엔진버전} 이 실제로 기록한 게이트 결과를 센 것이다(ann_rule_scores.게이트_결과).
          한 공고가 여러 게이트에 걸릴 수 있어 합계는 공고 수보다 클 수 있다.
        </p>
        {report.게이트별.length === 0 ? (
          <EmptyState title="걸린 게이트가 없다" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">규칙</th>
                  <th className="py-1.5 pr-3 font-medium">무엇을 보는가</th>
                  <th className="py-1.5 pr-3 text-right font-medium">건수</th>
                  <th className="py-1.5 font-medium">예시</th>
                </tr>
              </thead>
              <tbody>
                {report.게이트별.map((g) => (
                  <tr key={g.키} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{g.키}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{g.설명}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">
                      {g.건수.toLocaleString()}
                    </td>
                    <td className="py-2 text-[12px] text-muted-foreground">
                      {g.예시.map((e) => (
                        <div key={e.id} className="truncate">
                          <a href={`/announcements/${e.id}`} className="underline hover:text-foreground">
                            {e.사업명}
                          </a>
                          {e.사유 && <span className="opacity-70"> — {e.사유}</span>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 판정 분포 ──────────────────────────────────────────────────── */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold">판정 등급 분포</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            판정 대상 {판정합.toLocaleString()}건(마감 지난 공고는 애초에 제외).
          </p>
          <div className="grid gap-2.5">
            {report.판정분포.map((r) => (
              <div key={r.판정} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{r.판정}</span>
                  <span className="shrink-0 text-[13px] tabular-nums">
                    <b>{r.건수.toLocaleString()}</b>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {퍼센트(r.건수, 판정합)}
                    </span>
                  </span>
                </div>
                <Bar
                  값={r.건수}
                  최대={판정합}
                  색={
                    r.판정 === "가능" ? "var(--success-fg)"
                      : r.판정 === "불가" ? "var(--destructive)"
                        : r.판정 === "확인필요" ? "var(--warning-fg)"
                          : "var(--muted-foreground)"
                  }
                />
                <p className="text-[11px] text-muted-foreground">{r.설명}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* ── 판정 경로 · 학습 ───────────────────────────────────────────── */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold">무엇이 판정을 만들었나</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            규칙만으로 났는지, 사람이 남긴 판정(학습)이나 답변이 얹혔는지.
          </p>
          <div className="grid gap-2.5">
            {report.판정경로.map((p) => (
              <div key={p.경로} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{p.경로}</span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {p.건수.toLocaleString()}
                  </span>
                </div>
                <Bar 값={p.건수} 최대={판정합} 색="var(--muted-foreground)" />
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
            {[
              { 라벨: "사람이 남긴 판정", 값: report.학습.판정이력, 곁: "의미 학습(임베딩)" },
              { 라벨: "사람이 짚은 문구", 값: report.학습.렉시콘, 곁: "추출 규칙(렉시콘)" },
              { 라벨: "사람이 정정한 건", 값: report.학습.사람정정, 곁: "엔진 판정을 뒤집음" },
            ].map((s) => (
              <div key={s.라벨}>
                <div className="text-lg font-bold tabular-nums">{s.값.toLocaleString()}</div>
                <div className="text-[11px] font-medium">{s.라벨}</div>
                <div className="text-[10px] text-muted-foreground">{s.곁}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 출처별 ────────────────────────────────────────────────────── */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold">출처별 수집량</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            기업마당·K-Startup 은 공식 오픈API, IRIS·NTIS 는 공고 상세 수집.
          </p>
          <div className="grid gap-2">
            {report.수집.출처별.map((s) => (
              <div key={s.출처} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{s.출처}</span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {s.건수.toLocaleString()}
                  </span>
                </div>
                <Bar 값={s.건수} 최대={전체} 색="var(--muted-foreground)" />
              </div>
            ))}
          </div>
        </Card>

        {/* ── 본문 확보 ─────────────────────────────────────────────────── */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold">공고문 본문 확보 상태</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            「요건미확인」이 남는 이유가 여기 있다 — 본문을 못 받으면 조항을 읽을 수 없다.
          </p>
          <div className="grid gap-2">
            {report.본문확보.map((s) => (
              <div key={s.상태} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{s.상태}</span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {s.건수.toLocaleString()}
                  </span>
                </div>
                <Bar 값={s.건수} 최대={전체} 색="var(--muted-foreground)" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── 엔진 버전 추이 ───────────────────────────────────────────────── */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold">규칙을 고칠 때마다 판정이 어떻게 움직였나</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          엔진 버전은 지우지 않고 나란히 쌓는다 — 「고쳐서 나아졌는가」를 숫자로 되짚기 위해서다.
          같은 공고를 같은 날 여러 버전으로 판정한 결과라 서로 직접 비교된다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">버전</th>
                <th className="py-1.5 pr-3 text-right font-medium">가능</th>
                <th className="py-1.5 pr-3 text-right font-medium">확인필요</th>
                <th className="py-1.5 pr-3 text-right font-medium">요건미확인</th>
                <th className="py-1.5 pr-3 text-right font-medium">불가</th>
                <th className="py-1.5 pr-3 text-right font-medium">해당없음</th>
                <th className="py-1.5 text-right font-medium">합계</th>
              </tr>
            </thead>
            <tbody>
              {report.버전추이.map((v) => (
                <tr
                  key={v.엔진버전}
                  className={
                    "border-b last:border-0 " +
                    (v.엔진버전 === report.엔진버전 ? "bg-muted/40 font-medium" : "")
                  }
                >
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {v.엔진버전}
                    {v.엔진버전 === report.엔진버전 && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">현재</span>
                    )}
                  </td>
                  {(["가능", "확인필요", "요건미확인", "불가", "해당없음"] as const).map((k) => (
                    <td key={k} className="py-1.5 pr-3 text-right tabular-nums">
                      {(v.판정[k] ?? 0).toLocaleString()}
                    </td>
                  ))}
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {v.합계.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
