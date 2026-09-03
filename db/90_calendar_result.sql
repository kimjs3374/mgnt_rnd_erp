-- =============================================================================
-- 90_calendar_result.sql — 달력에 「결과 발표」를 더한다
--
--   2026-09-03 (mgnt1). v_calendar 를 통째로 다시 만든다(create or replace 라
--   컬럼 이름·순서는 그대로 두고 union 가지만 늘린다).
--
-- 왜
--   신청해 놓고 결과를 기다리는 사업이 지금 2건 있는데(projects.상태='신청중'),
--   달력에는 그 사업의 발표일이 안 뜬다. 케이오시 현안이 「일정 착오」인데
--   신청 결과 발표는 놓치면 다음 행동이 통째로 밀린다.
--
-- ⚠ 지금은 0건으로 나온다. projects 의 발표심사일·선정결과일이 12건 모두 비어 있다.
--   데이터를 지어내지 않는다 — 값이 들어오면 화면이 저절로 채워지도록 자리만 만든다.
--   (관리대장 「신청접수 및 결과」 열이 들어오면 그때 채워진다)
--
-- 「행동이 필요한 것만」이 기준이므로 **아직 결과가 안 나온 건만** 올린다.
--   선정결과가 이미 적힌 사업은 발표일을 봐도 할 일이 없다.
-- =============================================================================

begin;

create or replace view app.v_calendar as
with 오늘 as (select (now() at time zone 'Asia/Seoul')::date as d)

-- ① 관심 표시한 공고의 접수마감
select
  a.접수종료                        as 날짜,
  '관심공고'                        as 종류,
  a.사업명                          as 제목,
  coalesce(a.소관부처, a.전문기관)   as 부제,
  '공고'                            as 참조종류,
  a.id::text                        as 참조키,
  '/announcements'                  as 링크,
  (a.접수종료 - o.d)                as d_day
from app.announcements a
join app.watchlist w on w.종류 = '공고' and w.참조_id = a.id
cross join 오늘 o
where a.접수종료 is not null

union all
-- ② 진행 중 사업의 협약 종료
select p.종료일, '사업종료', p.과제명, coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.종료일 - o.d)
from app.projects p cross join 오늘 o
where p.종료일 is not null and coalesce(p.상태, '') <> '종료'

union all
-- ③ 중간보고 — 아직 안 낸 것만
select p.중간보고_예정, '보고예정', p.과제명 || ' · 중간보고', coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.중간보고_예정 - o.d)
from app.projects p cross join 오늘 o
where p.중간보고_예정 is not null and p.중간보고_완료 is null

union all
-- ④ 완료보고 — 아직 안 낸 것만
select p.완료보고_예정, '보고예정', p.과제명 || ' · 완료보고', coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.완료보고_예정 - o.d)
from app.projects p cross join 오늘 o
where p.완료보고_예정 is not null and p.완료보고_완료 is null

union all
-- ⑤ ★ 새로 추가 — 발표·심사일. 결과가 아직 안 나온 건만
select p.발표심사일, '결과발표', p.과제명 || ' · 발표심사', coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.발표심사일 - o.d)
from app.projects p cross join 오늘 o
where p.발표심사일 is not null and p.선정결과 is null

union all
-- ⑥ ★ 새로 추가 — 선정 결과 발표 예정일. 결과가 적히면 사라진다
select p.선정결과일, '결과발표', p.과제명 || ' · 결과 발표', coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.선정결과일 - o.d)
from app.projects p cross join 오늘 o
where p.선정결과일 is not null and p.선정결과 is null

union all
-- ⑦ 서류 만료 — 유효한 서류는 올리지 않는다. 봐도 할 일이 없다
select v.만료일, '서류만료', v.이름, v.상태,
       '서류', v.코드, '/documents', (v.만료일 - o.d)
from app.v_document_status v cross join 오늘 o
where v.만료일 is not null and v.상태 in ('만료', '만료임박');

comment on view app.v_calendar is
  '일정 달력. 관심공고 마감 · 협약종료 · 보고예정 · 결과발표 · 서류만료를 한 모양으로 모은다. '
  '색은 여기 없다 — 종류만 주고 화면이 고른다. '
  '「행동이 필요한 것만」이 기준이라 유효한 서류·종료된 사업·결과가 이미 나온 건은 빠진다.';

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기 — 80_calendar_watchlist.sql 의 v_calendar 정의를 다시 실행하면 된다.
-- =============================================================================
