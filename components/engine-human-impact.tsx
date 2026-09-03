import { Card } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import type { HumanImpact } from "@/lib/queries-engine"

/**
 * 사람 입력의 효과 — "사람이 넣으면 무엇이 달라지는가"를 숫자로 보인다.
 *
 * 사용자 요청(2026-09-04): "사람이 입력한 공고별 분류나 코멘트들을 입력하므로써 어떻게
 * 변화되었는지도 보고싶음".
 *
 * 이 프로젝트의 핵심 주장이 여기 걸려 있다 — 규칙은 쌓아도 안 늘지만 **사람이 남긴 판단은
 * 쌓인다**(CLAUDE.md 판단 우선순위). 그 주장을 숫자로 못 보이면 구호일 뿐이다.
 *
 * ⚠ 전/후를 잴 때 **대상 건수가 같은 구간에서만 잰다.** 마감 제외를 도입하며 836 → 501 로
 *   줄어든 구간을 끼워 "확인필요가 줄었다"고 말하면 그건 거짓말이다.
 */

const 등급색: Record<string, string> = {
  가능: "var(--success-fg)",
  확인필요: "var(--warning-fg)",
  요건미확인: "var(--muted-foreground)",
  불가: "var(--destructive)",
  해당없음: "var(--muted-foreground)",
}

function 델타(전: number, 후: number): { 글: string; 색: string } {
  const d = 후 - 전
  if (d === 0) return { 글: "변화 없음", 색: "var(--muted-foreground)" }
  return { 글: `${d > 0 ? "+" : ""}${d}`, 색: d > 0 ? "var(--success-fg)" : "var(--destructive)" }
}

export function EngineHumanImpact({ impact }: { impact: HumanImpact }) {
  if (impact.error) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold">사람이 넣은 것이 무엇을 바꿨나</h2>
        <DbError what="사람 입력 효과" error={impact.error} />
      </Card>
    )
  }

  const 총입력 =
    impact.입력.판정코멘트 + impact.입력.짚은문구 + impact.입력.회사답변 + impact.입력.되돌림

  // 대상 건수가 같은 구간만 잘라 전/후를 잰다.
  const 구간 = impact.비교구간
  const 시작행 = 구간 ? impact.추이.find((t) => t.엔진버전 === 구간.시작) : null
  const 끝행 = 구간 ? impact.추이.find((t) => t.엔진버전 === 구간.끝) : null
  const 비교대상 = 구간 ? impact.추이.filter((t) => t.합계 === 구간.합계) : impact.추이
  const 최대합 = Math.max(...비교대상.map((t) => t.합계), 1)

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">사람이 넣은 것이 무엇을 바꿨나</h2>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
        규칙은 쌓아도 늘지 않지만 <b>사람이 남긴 판단은 쌓인다</b>. 지금까지 사람이 넣은
        입력 <b>{총입력}건</b>이 판정에 어떻게 닿았는지 — 그리고 그 결과 판정 분포가
        어떻게 움직였는지.
      </p>

      {/* 사람이 넣은 것 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { 라벨: "판정 코멘트", 값: impact.입력.판정코멘트,
            곁: "왜 그렇게 봤는지 문장으로 — 뜻이 비슷한 다음 공고에서 참고된다" },
          { 라벨: "짚은 문구", 값: impact.입력.짚은문구,
            곁: "공고문 문구를 규칙으로 등록 — 글자 그대로 걸린다" },
          { 라벨: "회사 사실 답변", 값: impact.입력.회사답변,
            곁: "한 번 답하면 모든 공고에 얹힌다(체납·참여제한 등)" },
          { 라벨: "판정 되돌림", 값: impact.입력.되돌림,
            곁: "엔진 판정을 사람이 뒤집음 — 엔진이 다시 못 덮는다" },
        ].map((s) => (
          <div key={s.라벨} className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">{s.라벨}</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">{s.값}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.곁}</div>
          </div>
        ))}
      </div>

      {/* 그 입력이 판정에 닿은 정도 */}
      <div className="mb-4 rounded-lg border bg-background p-3">
        <h3 className="mb-2 text-[13px] font-semibold">그래서 판정에 얼마나 닿았나</h3>
        <ul className="grid gap-1.5 text-[12.5px]">
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              사람 답변이 얹힌 판정 (판정경로에 「사람」이 붙은 건)
            </span>
            <b className="tabular-nums">{impact.효과.사람답변적용.toLocaleString()}건</b>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              과거 판정(학습)이 결론을 만든 건 — 현재 버전
            </span>
            <b className="tabular-nums">{impact.효과.학습으로판정_현재}건</b>
          </li>
          {impact.효과.학습으로판정_최대 && (
            <li className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                학습이 가장 많이 일한 버전 — 그 뒤 규칙이 그 자리를 가져갔다
              </span>
              <b className="tabular-nums">
                {impact.효과.학습으로판정_최대.엔진버전} · {impact.효과.학습으로판정_최대.건수}건
              </b>
            </li>
          )}
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">짚은 문구가 실제로 걸린 공고</span>
            <b className="tabular-nums">{impact.효과.렉시콘특징}건</b>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              사람이 되돌려 엔진이 덮지 못하는 확정
            </span>
            <b className="tabular-nums">{impact.효과.되돌림확정}건</b>
          </li>
        </ul>
      </div>

      {/* 판정 분포가 실제로 어떻게 움직였나 */}
      <div>
        <h3 className="mb-1 text-[13px] font-semibold">판정 분포가 실제로 어떻게 움직였나</h3>
        {구간 && 시작행 && 끝행 ? (
          <>
            <p className="mb-2 text-[11px] text-muted-foreground">
              <b>대상 {구간.합계.toLocaleString()}건이 동일한 {구간.시작}~{구간.끝} 구간</b>만
              잘라서 잰다 — 마감 제외를 도입하며 대상 자체가 줄어든 구간을 끼워 넣으면
              「좋아졌다」가 거짓말이 된다.
            </p>
            <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(["가능", "확인필요", "요건미확인", "불가", "해당없음"] as const).map((k) => {
                const d = 델타(시작행[k], 끝행[k])
                return (
                  <div key={k} className="rounded-md border bg-background p-2.5">
                    <div className="text-[11px]" style={{ color: 등급색[k] }}>{k}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-[13px] tabular-nums text-muted-foreground">
                        {시작행[k]}
                      </span>
                      <span className="text-[11px] text-muted-foreground">→</span>
                      <span className="text-lg font-bold tabular-nums">{끝행[k]}</span>
                    </div>
                    <div className="text-[11px] font-medium tabular-nums" style={{ color: d.색 }}>
                      {d.글}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <p className="mb-2 text-[11px] text-muted-foreground">
            아직 대상 건수가 같은 연속 구간이 없어 전/후를 재지 않는다.
          </p>
        )}

        {/* 버전별 누적 막대 */}
        <div className="grid gap-1">
          {비교대상.map((t) => (
            <div key={t.엔진버전} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {t.엔진버전}
              </span>
              <div className="flex h-3.5 flex-1 overflow-hidden rounded">
                {(["가능", "확인필요", "요건미확인", "불가", "해당없음"] as const).map((k) =>
                  t[k] > 0 ? (
                    <div
                      key={k}
                      title={`${k} ${t[k]}건`}
                      style={{
                        width: `${(t[k] / 최대합) * 100}%`,
                        background: 등급색[k],
                        opacity: k === "해당없음" ? 0.45 : k === "요건미확인" ? 0.28 : 1,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                가능 {t.가능} · 확인 {t.확인필요}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
          {(["가능", "확인필요", "요건미확인", "불가", "해당없음"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-[2px]"
                style={{
                  background: 등급색[k],
                  opacity: k === "해당없음" ? 0.45 : k === "요건미확인" ? 0.28 : 1,
                }}
              />
              {k}
            </span>
          ))}
        </div>
      </div>

      {/* 사람이 넣은 것 — 최근 순 */}
      <div className="mt-4">
        <h3 className="mb-1.5 text-[13px] font-semibold">사람이 넣은 것 (최근 순)</h3>
        {impact.타임라인.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">아직 입력이 없다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">종류</th>
                  <th className="py-1.5 pr-3 font-medium">내용</th>
                  <th className="py-1.5 pr-3 font-medium">사람</th>
                  <th className="py-1.5 font-medium">일시</th>
                </tr>
              </thead>
              <tbody>
                {impact.타임라인.map((t, i) => (
                  <tr key={`${t.종류}-${t.시각}-${i}`} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium">{t.종류}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {t.공고 ? (
                        <a
                          href={`/announcements/${t.공고}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {t.내용}
                        </a>
                      ) : (
                        t.내용
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{t.사람}</td>
                    <td className="py-1.5 whitespace-nowrap text-muted-foreground">
                      {t.시각.slice(5, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
