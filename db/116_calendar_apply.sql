-- =============================================================================
-- 116_calendar_apply.sql — 달력이 「신청해 놓고 기다리는 것」을 보게 한다
--
--   왜 (2026-09-04, 알림 발송기를 붙이다가 실측으로 걸렸다)
--     ① `projects.선정결과` 는 신청하면 **'접수'** 가 들어간다. null 이 아니다.
--        90_calendar_result.sql 의 ⑤⑥ 가지는 `선정결과 is null` 로 걸러서,
--        정작 결과를 기다리는 건이 **전부 빠졌다**(78·79·109 세 건 모두 '접수').
--        「결과가 아직 안 나온 것」은 null 이거나 '접수' 이거나 둘 다다.
--     ② 신청중 사업의 **접수 마감일**을 올리는 가지가 아예 없었다.
--        projects.마감일 에 값이 있는데(09-07·09-11·09-21) 달력에는 안 떴다.
--        케이오시 현안이 「일정 착오」인데 접수 마감을 놓치면 그걸로 끝이다.
--
--   이 파일이 90_calendar_result.sql 을 고치지 않고 뷰를 다시 만드는 이유
--     그 파일은 mgnt1 이 쓴 것이고 지금도 열려 있을 수 있다. 남이 잡은 파일은
--     고치지 않고 덧씌운다 — 정의는 여기 전부 다시 적는다(create or replace 라
--     컬럼 이름·순서는 그대로다).
--
--   ⚠ 뷰 소유자가 supabase_admin 이라 rnd_dev 로는 못 바꾼다.
--      적용:   sudo docker exec -i rnd-db psql -U supabase_admin -d postgres \
--                 < db/116_calendar_apply.sql
--      (db/psql.sh 로 돌리면 "must be owner of view v_calendar" 로 막힌다)
--
--   되돌리기: 파일 맨 아래
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
-- ⑤ 발표·심사일. 결과가 아직 안 나온 건만 (★ '접수' 를 포함하도록 고침)
select p.발표심사일, '결과발표', p.과제명 || ' · 발표심사', coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.발표심사일 - o.d)
from app.projects p cross join 오늘 o
where p.발표심사일 is not null and (p.선정결과 is null or p.선정결과 = '접수')

union all
-- ⑥ 선정 결과 발표 예정일. 결과가 적히면 사라진다 (★ '접수' 를 포함하도록 고침)
select p.선정결과일, '결과발표', p.과제명 || ' · 결과 발표', coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.선정결과일 - o.d)
from app.projects p cross join 오늘 o
where p.선정결과일 is not null and (p.선정결과 is null or p.선정결과 = '접수')

union all
-- ⑦ ★ 새로 추가 — 신청중 사업의 접수 마감. 놓치면 그걸로 끝나는 날짜다.
--    `상태='신청중'` 만으로 거르지 않는다. 결과가 이미 적힌 건은 마감일을 봐도 할 일이 없다.
select p.마감일, '신청마감', p.과제명, coalesce(p.전문기관, p.부처),
       '사업', p.id::text, '/programs', (p.마감일 - o.d)
from app.projects p cross join 오늘 o
where p.마감일 is not null
  and p.상태 = '신청중'
  and (p.선정결과 is null or p.선정결과 = '접수')

union all
-- ⑧ 서류 만료 — 유효한 서류는 올리지 않는다. 봐도 할 일이 없다
select v.만료일, '서류만료', v.이름, v.상태,
       '서류', v.코드, '/documents', (v.만료일 - o.d)
from app.v_document_status v cross join 오늘 o
where v.만료일 is not null and v.상태 in ('만료', '만료임박');

comment on view app.v_calendar is
  '일정 달력. 관심공고 마감 · 협약종료 · 보고예정 · 결과발표 · 신청마감 · 서류만료를 '
  '한 모양으로 모은다. 색은 여기 없다 — 종류만 주고 화면이 고른다. '
  '「행동이 필요한 것만」이 기준이라 유효한 서류·종료된 사업·결과가 이미 나온 건은 빠진다. '
  '⚠ 「결과가 아직 안 나옴」 = 선정결과가 null 이거나 ''접수''. 신청하면 ''접수'' 가 '
  '들어가므로 null 만 보면 정작 기다리는 건이 통째로 빠진다.';

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기 — 90_calendar_result.sql 을 다시 실행하면 이 파일 이전 정의로 돌아간다.
-- =============================================================================
