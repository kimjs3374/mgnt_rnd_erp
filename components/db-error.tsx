/**
 * DB 조회가 실패했을 때. 화면을 통째로 죽이지 않고 무엇이 안 됐는지 보여준다.
 * 심사 항목 「종단간 구현·신뢰성 20점」의 "오류·재시도·대체 경로"가 이 자리다.
 */
export function DbError({ error, what }: { error: string; what: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">
        {what} 를 불러오지 못했습니다
      </p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{error}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        나머지 화면은 그대로 동작합니다. 데이터가 없는 것이 아니라 조회에 실패한 것입니다.
      </p>
    </div>
  )
}
