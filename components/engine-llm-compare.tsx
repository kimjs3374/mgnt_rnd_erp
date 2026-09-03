import { Card } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import type { LlmCompare } from "@/lib/queries-engine"

/**
 * LLM 대조 — 「규칙으로도 된다」는 주장의 유일한 근거를 눈으로 보게 한다.
 *
 * 사용자 요청(2026-09-04): "llm으로 수정했을때 어떻게 되는지와 우리가 만든 엔진으로
 * 어떻게 되는지 서로 비교해서 수치를 눈으로 볼수있으면 좋겠음".
 *
 * ⚠ 이 화면이 절대 말하지 않는 것 — "일치율이 높으니 엔진이 옳다".
 *   일치율은 **얼마나 닮았나**이지 얼마나 맞나가 아니다. LLM 도 틀린다(실측: 마감 지난
 *   공고를 확인필요로 둠, 지역이 안 맞는데 60점). 그래서 불일치 목록을 같이 펼쳐 두고
 *   사람이 어느 쪽이 맞는지 보게 한다. 숫자 하나로 결론짓지 않는 게 이 프로젝트의 규칙이다.
 */

function 판정색(v: string): string {
  return v === "가능" ? "var(--success-fg)"
    : v === "불가" ? "var(--destructive)"
      : v === "확인필요" ? "var(--warning-fg)"
        : "var(--muted-foreground)"
}

export function EngineLlmCompare({ cmp }: { cmp: LlmCompare }) {
  if (cmp.error) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold">LLM 대조</h2>
        <DbError what="LLM 대조" error={cmp.error} />
      </Card>
    )
  }

  // 등급 막대가 더 길므로 그쪽까지 포함해 최대값을 잡는다 — 안 그러면 막대가 넘친다.
  const 최고 = Math.max(...cmp.버전별.flatMap((v) => [v.일치율, v.등급일치율]), 1)

  // 값이 그대로인 버전은 접는다 — 16줄을 다 그리면 같은 막대가 반복돼 무엇이 달라졌는지
  // 안 보인다(사용자 지적 2026-09-04: "이게 무슨말을 하고싶은건지 모르겠다").
  // 첫 버전과 현재 버전은 기준점이라 값이 같아도 항상 남긴다.
  const 변화지점 = cmp.버전별.filter((v, i, arr) => {
    if (i === 0 || i === arr.length - 1) return true
    const 앞 = arr[i - 1]
    return v.일치율 !== 앞.일치율 || v.등급일치율 !== 앞.등급일치율
  })
  const 첫 = cmp.버전별[0]
  const 끝 = cmp.버전별[cmp.버전별.length - 1]

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">LLM 판정 vs 규칙 엔진</h2>

      {/* ⚠ 결론을 먼저 쓴다. 숫자만 늘어놓으면 "그래서 무슨 말이냐"가 된다
          (사용자 지적 2026-09-04: "이게 무슨말을 하고싶은건지 모르겠다"). */}
      <div className="mt-2 mb-3 rounded-lg border-l-4 border-l-[var(--success-fg)] bg-muted/40 p-3">
        <p className="text-[13px] leading-relaxed">
          <b>이 표가 말하는 것 —</b> LLM 은 비용 때문에{" "}
          <b>{cmp.처리량.llm_판정건수}건</b>에서 멈췄고, 규칙 엔진은{" "}
          <b>{cmp.처리량.엔진_판정건수}건</b>을 <b>LLM 호출 {cmp.처리량.엔진_llm호출}회</b>로
          판정했다. 겹치는 {cmp.표본}건에서 두 방식은 등급 기준{" "}
          <b>{cmp.등급일치율.toFixed(0)}%</b>가 같은 결론이고, 갈린 자리는 대부분{" "}
          <b>엔진이 「본문을 못 읽었다」고 정직하게 말한 곳</b>이다.
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          <b>이 표가 말하지 않는 것 —</b> 「일치율이 높으니 엔진이 옳다」. 일치율은 얼마나
          닮았나이지 얼마나 맞나가 아니다. LLM 도 틀린다. 그래서 아래에 갈린 건을 그대로 편다.
        </p>
      </div>

      {/* 요약 3칸 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs text-muted-foreground">일치율 ({cmp.현재버전})</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{cmp.일치율.toFixed(1)}%</span>
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">
              / 등급 {cmp.등급일치율.toFixed(1)}%
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            글자 그대로 {cmp.일치}건 · 등급으로 묶으면 {cmp.등급일치}건 (표본 {cmp.표본}건)
          </div>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs text-muted-foreground">규칙을 고치며 달라진 폭</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {첫 && 끝 ? `${첫.일치율.toFixed(1)}% → ${끝.일치율.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {첫?.엔진버전} → {끝?.엔진버전} (같은 표본 {cmp.표본}건)
          </div>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs text-muted-foreground">처리량 대비</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {cmp.처리량.llm_판정건수} : {cmp.처리량.엔진_판정건수}
          </div>
          <div className="text-[11px] text-muted-foreground">
            LLM 이 판정한 수 : 엔진이 판정한 수
          </div>
        </div>
      </div>

      {/* 버전별 일치율 추이 — **값이 바뀐 버전만** 남긴다.
          16줄을 다 그리면 같은 값이 반복돼 무엇이 달라졌는지가 안 보인다(사용자 지적). */}
      <div className="mb-4">
        <h3 className="mb-1.5 text-[13px] font-semibold">일치율이 바뀐 지점만</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">
          같은 공고 {cmp.표본}건을 버전마다 다시 판정한 결과다(표본 고정). 값이 그대로인
          버전은 접었다 — 규칙을 고쳐서 <b>실제로 판정이 움직인 지점</b>만 남긴다.
          진한 막대가 글자 그대로 일치, 옅은 부분이 등급으로 묶었을 때(확인필요·요건미확인을
          「미확정」 하나로) 추가로 맞는 몫이다.
        </p>
        <div className="grid gap-1">
          {변화지점.map((v) => (
            <div key={v.엔진버전} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {v.엔진버전}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted">
                {/* 등급 일치(넓은 쪽)를 먼저 옅게 깔고, 그 위에 글자 일치를 진하게 덮는다 */}
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${Math.max(2, (v.등급일치율 / 최고) * 100)}%`,
                    background: "color-mix(in oklab, var(--success-fg) 30%, transparent)",
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${Math.max(2, (v.일치율 / 최고) * 100)}%`,
                    background: v.엔진버전 === cmp.현재버전
                      ? "var(--success-fg)" : "var(--muted-foreground)",
                  }}
                />
              </div>
              <span className="w-32 shrink-0 text-right text-[11px] tabular-nums">
                {v.일치율.toFixed(1)}%
                <span className="ml-1 text-muted-foreground">
                  / 등급 {v.등급일치율.toFixed(0)}%
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 혼동 행렬 */}
      <div className="mb-4">
        <h3 className="mb-1.5 text-[13px] font-semibold">어디서 갈리나 (행 = LLM, 열 = 엔진)</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">
          대각선이 두 방식이 같은 말을 한 자리다. 대각선을 벗어난 칸이 사람이 봐야 할 자리다.
        </p>
        <div className="overflow-x-auto">
          <table className="text-[12px]">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium text-muted-foreground">
                  LLM ＼ 엔진
                </th>
                {cmp.판정라벨.map((c) => (
                  <th key={c} className="px-2 py-1 font-medium" style={{ color: 판정색(c) }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cmp.판정라벨.map((r) => (
                <tr key={r}>
                  <th
                    className="px-2 py-1 text-left font-medium whitespace-nowrap"
                    style={{ color: 판정색(r) }}
                  >
                    {r}
                  </th>
                  {cmp.판정라벨.map((c) => {
                    const n = cmp.혼동행렬.find((x) => x.llm === r && x.규칙 === c)?.건수 ?? 0
                    const 같음 = r === c
                    return (
                      <td
                        key={c}
                        className={
                          "px-2 py-1 text-center tabular-nums " +
                          (n === 0 ? "text-muted-foreground/40"
                            : 같음 ? "font-bold" : "font-medium")
                        }
                        style={n > 0 ? {
                          background: 같음
                            ? "color-mix(in oklab, var(--success-fg) 14%, transparent)"
                            : "color-mix(in oklab, var(--warning-fg) 14%, transparent)",
                        } : undefined}
                      >
                        {n}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 불일치 목록 */}
      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold">갈린 건 — 어느 쪽이 맞는지는 사람이 본다</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">
          <b>일치율이 높다고 엔진이 옳은 것은 아니다.</b> LLM 도 틀린다(실측: 마감이 지난 공고를
          「확인필요」로 둔 건, 지역이 안 맞는데 60점을 준 건이 있었다). 그래서 숫자로 결론짓지
          않고 갈린 건을 그대로 편다.
        </p>
        {cmp.불일치.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">갈린 건이 없다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">공고</th>
                  <th className="py-1.5 pr-3 font-medium">LLM</th>
                  <th className="py-1.5 pr-3 font-medium">엔진</th>
                  <th className="py-1.5 pr-3 text-right font-medium">커버리지</th>
                  <th className="py-1.5 font-medium">사람</th>
                </tr>
              </thead>
              <tbody>
                {cmp.불일치.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      <a
                        href={`/announcements/${d.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {d.사업명}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 판정색(d.llm_판정) }}>
                      {d.llm_판정}
                      {d.llm_점수 != null && (
                        <span className="ml-1 text-muted-foreground">{d.llm_점수}점</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 판정색(d.규칙_판정) }}>
                      {d.규칙_판정}
                      {d.규칙_점수 != null && (
                        <span className="ml-1 text-muted-foreground">{d.규칙_점수}점</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {d.커버리지?.toFixed(2) ?? "—"}
                    </td>
                    <td className="py-1.5 whitespace-nowrap text-muted-foreground">
                      {d.사람정정 ? "정정함" : "—"}
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
