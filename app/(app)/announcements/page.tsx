import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * 공고 탐색 — 유일한 비로그인 공개 영역.
 * 공고는 공공데이터(기업마당·K-Startup 공식 오픈 API)라 실데이터를 그대로 써도 된다.
 * ⚠ 크롤링하지 않는다. 공식 API만 쓴다.
 *
 * 붙일 곳: app.announcements + app.ann_requirements × app.company_profile
 */
export default function AnnouncementsPage() {
  return (
    <PageShell
      title="공고 탐색"
      description="공고문을 넣으면 자격 요건·제출 서류·계상 규칙을 뽑아 우리 것과 대조한다."
      actions={
        <Button type="button" className="h-7 text-[12.8px]">
          공고문 업로드
        </Button>
      }
      filters={
        <>
          <Input placeholder="사업명·기관 검색" className="h-7 w-56 text-[13px]" />
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            전체 분야
          </Button>
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            접수 중
          </Button>
          <Button type="button" variant="ghost" className="ml-auto h-7 text-[12.8px]">
            ↺ 초기화
          </Button>
        </>
      }
    >
      <Card>
        <EmptyState
          title="아직 수집된 공고가 없습니다"
          hint="기업마당 API 연동을 붙이면 여기에 채워집니다. 전량이 단일 호출로 옵니다."
        />
      </Card>

      <div className="rounded-lg border bg-card p-4 text-[13px]">
        <h2 className="mb-2 text-sm font-semibold">판정 등급 4종</h2>
        <ul className="space-y-1 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">가능</span> — 요건을 읽었고 충족한다
          </li>
          <li>
            <span className="font-medium text-foreground">불가</span> — 요건을 읽었고 미충족이다
          </li>
          <li>
            <span className="font-medium text-foreground">확인 필요</span> — 읽었으나 회사 값이 없다
          </li>
          <li>
            <span className="font-medium text-foreground">요건 미확인</span> — 아직 안 읽었다.
            <span className="ml-1">
              「확인 필요」보다 <b>아래</b>에 둔다 — 안 그러면 요건을 읽어 문제를 찾은 쪽이 손해를 본다
            </span>
          </li>
        </ul>
      </div>
    </PageShell>
  )
}
