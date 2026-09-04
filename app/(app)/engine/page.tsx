import { PageShell, Card } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { EngineReportView } from "@/components/engine-report"
import { ReversePanel } from "@/components/reverse-panel"
import { getEngineReport, getReversible } from "@/lib/queries-engine"
import { getReversalHistory } from "@/app/actions/engine"

export const dynamic = "force-dynamic"

/**
 * 판정 리포트 — 지원사업·과제사업을 통틀어 **규칙 엔진이 무엇을 어떻게 걸렀는지**를
 * 정량으로 보여주고, 접힌 것을 사람이 되돌릴 수 있게 하는 화면.
 *
 * 사용자 요청(2026-09-04)
 *   "api로 받아온 raw데이터 대비해서 엔진의 어떤 로직을 기반으로 제외했고 어떻게 이렇게
 *    데이터들이 산출되는지 시각적으로 볼수있고 정량적인 데이터 기반으로 확인할 수 있는
 *    페이지가 필요함"
 *   "불가 판정이나 해당없음 판정 받았던 건들 중에 사람이 직접 확인해서 반대로 가능으로
 *    상태변경이나 신청해서 관리할 수 있도록 하는 역방향도 구현해"
 *
 * 두 요구가 한 화면에 있는 이유 — 근거(왜 걸렀나)를 보지 않고 되돌리면 그건 그냥 뒤집기다.
 * 같은 화면에서 규칙의 결과와 그 근거를 보고, 납득이 안 되는 건을 바로 되돌린다.
 *
 * ⚠ 여기 두지 않는 것 — 엔진 버전 추이 · LLM 대조 · 사람 입력 효과.
 *   사용자 지적(2026-09-04): "판정리포트에다가 내용을 넣어봐야 어짜피 실서비스할때
 *   의미없는데이터임 … 판정리포트에는 어떻게 판정했는지만 보여주면되고". 맞다 — 이 화면은
 *   실무자가 「이 공고가 왜 이렇게 판정됐나」를 보는 자리다. 규칙을 몇 번 고쳤고 LLM 과
 *   얼마나 닮았는지는 **만드는 쪽의 관심사**라 화면에 두면 실무를 가린다.
 *   그 자료는 별도 아티팩트로 정리해 둔다(집계 함수 getLlmCompare·getHumanImpact 는
 *   지우지 않고 남겨 둔다 — 아티팩트를 갱신할 때 같은 숫자를 다시 뽑아야 한다).
 */
export default async function EnginePage() {
  const [report, 되돌림후보, 되돌림이력] = await Promise.all([
    getEngineReport(),
    getReversible(),
    getReversalHistory(),
  ])

  return (
    <PageShell
      title="판정 리포트"
      description="수집한 공고를 규칙 엔진이 어떤 근거로 걸러냈는지 — 그리고 접힌 것을 사람이 다시 여는 자리."
    >
      <EngineReportView report={report} />

      <Card className="p-4">
        <h2 className="text-sm font-semibold">엔진이 접은 것을 다시 열기</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          「불가」·「해당없음」으로 접혔지만 <b>아직 마감 전</b>인 공고다. 규칙이 틀렸을 때
          되돌릴 길이 없으면 신청할 수 있는 공고가 조용히 사라진다 — 그래서 근거를 같이
          펼쳐 두고, 사람이 다르게 보면 바로 확정을 뒤집을 수 있게 했다.
        </p>
        {되돌림후보.전체 > 되돌림후보.rows.length && (
          <p className="mb-2 text-[12.1px] text-muted-foreground">
            마감 전 후보 {되돌림후보.전체.toLocaleString()}건 중 <b>확신도가 낮은
            {" "}{되돌림후보.rows.length}건</b>만 띄운다 — 기계가 덜 확신한 것일수록 사람이
            볼 값어치가 크다. 나머지는 공고 탐색에서 「불가 숨김」을 끄면 전부 보인다.
          </p>
        )}
        {되돌림후보.error ? (
          <DbError what="되돌리기 후보" error={되돌림후보.error} />
        ) : (
          <ReversePanel rows={되돌림후보.rows} />
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">사람이 되돌린 이력</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          이 숫자가 늘면 규칙을 고쳐야 한다는 뜻이다 — 숨기지 않고 그대로 센다.
        </p>
        {되돌림이력.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            아직 사람이 되돌린 건이 없다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14.3px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">공고</th>
                  <th className="py-1.5 pr-3 font-medium">사람 확정</th>
                  <th className="py-1.5 pr-3 font-medium">사유</th>
                  <th className="py-1.5 pr-3 font-medium">확정자</th>
                  <th className="py-1.5 font-medium">일시</th>
                </tr>
              </thead>
              <tbody>
                {되돌림이력.map((h, i) => (
                  <tr key={`${h.announcement_id}-${i}`} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <a
                        href={`/announcements/${h.announcement_id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {h.사업명 ?? `공고 ${h.announcement_id}`}
                      </a>
                    </td>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{h.확정_판정}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{h.정정사유 ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{h.확정자 ?? "—"}</td>
                    <td className="py-2 whitespace-nowrap text-muted-foreground">
                      {h.created_at.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  )
}
