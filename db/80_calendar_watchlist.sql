-- =============================================================================
-- 80_calendar_watchlist.sql — 관심 표시와 일정 달력
--
--   2026-09-03 작성·적용 (mgnt1). 대시보드를 「오늘 손댈 것」만 남기는 개편의 뒷단.
--
-- 왜 필요한가
--   케이오시 현안 원문의 세 문제 중 하나가 「일정 착오」다. 그런데 지금 일정을 한곳에
--   모아 보는 데가 없다. 마감은 사업 대장에, 보고 예정은 projects 컬럼에, 서류 만료는
--   서류함에 흩어져 있다. 흩어져 있으면 「챙겨 보는 사람이 없어 모르고 지나간다」가 그대로 남는다.
--
-- 설계 원칙
--   ① 추가만 한다. 기존 테이블·뷰의 컬럼을 지우거나 바꾸지 않는다.
--      v_announcement_board 는 create or replace 로 **맨 끝에 컬럼 하나만** 덧붙인다
--      (Postgres 는 뷰 교체 시 끝에 추가하는 것만 허용한다).
--   ② 「행동이 필요한 것만」 올린다. 이게 대시보드 개편의 기준이다.
--      → 유효한 서류의 만료일은 달력에 올리지 않는다. 봐도 할 일이 없다.
--        만료·만료임박만 올린다.
--      → 이미 종료된 사업의 협약종료일도 올리지 않는다.
--   ③ 날짜가 없는 것을 버리지 않는다. 접수기간의 56%가 날짜가 아니다(상시·소진시·선착순).
--      달력에 못 올리는 것은 v_calendar_undated 로 따로 내보내 화면이 옆에 세운다.
--      안 그러면 관심 표시한 공고가 화면에서 조용히 사라진다.
--   ④ DB TimeZone 이 UTC 다. d_day 는 Asia/Seoul 기준으로 계산한다.
--   ⑤ 색은 DB 에 두지 않는다. 종류만 주고 화면이 색을 고른다 — 색은 표현이다.
--
-- 적용: Studio pg-meta (memory/announcement-board-schema.md 참조)
-- 되돌리기: 파일 맨 아래
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 관심 표시
--    로그인이 아직 없다. 그래서 사용자별이 아니라 조직 공용이다 —
--    10인 미만 회사라 오히려 이쪽이 실제에 가깝다. 로그인이 붙으면 사용자 컬럼을 더한다.
-- -----------------------------------------------------------------------------
create table if not exists app.watchlist (
  id         bigserial primary key,
  종류       text   not null check (종류 in ('공고','사업')),
  참조_id    bigint not null,
  메모       text,
  created_at timestamptz not null default now(),
  unique (종류, 참조_id)
);

comment on table app.watchlist is
  '관심 표시. 사람이 「이건 챙겨보겠다」고 손으로 누른 것 — 판단 이력의 가장 가벼운 형태다. '
  'FK 를 걸지 않는다: 종류에 따라 참조 대상 테이블이 다르기 때문이다.';

create index if not exists idx_watchlist_종류 on app.watchlist (종류, 참조_id);

-- -----------------------------------------------------------------------------
-- 2. 공고 보드에 관심 여부를 더한다 (맨 끝 컬럼 추가)
-- -----------------------------------------------------------------------------
create or replace view app.v_announcement_board as
select
  a.id,
  a.출처,
  a.출처_id,
  a.사업명,
  coalesce(a.소관부처, a.전문기관)                       as 기관,
  a.소관부처,
  a.전문기관,
  a.지역,
  a.사업유형,
  fs.이름                                                as 사업유형명,
  coalesce(fs.대분류, '미분류')                          as 구분,

  a.공고일,
  (a.created_at at time zone 'Asia/Seoul')::date         as 수집일,
  case when a.공고일 is not null then '공고일' else '수집일' end as 날짜출처,
  coalesce(a.공고일, (a.created_at at time zone 'Asia/Seoul')::date) as 기준일,

  coalesce(a.공고일, (a.created_at at time zone 'Asia/Seoul')::date)
    = (now() at time zone 'Asia/Seoul')::date            as 신규,

  a.접수시작,
  a.접수종료,
  a.마감유형,
  case when a.접수종료 is not null
       then a.접수종료 - (now() at time zone 'Asia/Seoul')::date end as d_day,

  a.파싱상태,
  a.공고문_url,
  a.created_at,

  (w.id is not null)                                     as 관심   -- ← 새 컬럼(맨 끝)
from app.announcements a
left join app.funding_schemes fs on fs.코드 = a.사업유형
left join app.watchlist w on w.종류 = '공고' and w.참조_id = a.id;

-- -----------------------------------------------------------------------------
-- 3. 일정 달력 — 흩어진 날짜를 한 줄 모양으로 모은다
--    화면(달력·이번주 패널)은 이 뷰 하나만 읽는다.
-- -----------------------------------------------------------------------------
create or replace view app.v_calendar as
with 오늘 as (select (now() at time zone 'Asia/Seoul')::date as d)

-- ① 관심 표시한 공고의 접수마감 — 사람이 직접 챙기겠다고 누른 것
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
-- ② 진행 중 사업의 협약 종료. 이미 끝난 사업은 올리지 않는다
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
-- ⑤ 서류 만료 — 유효한 서류는 올리지 않는다. 봐도 할 일이 없다
select v.만료일, '서류만료', v.이름, v.상태,
       '서류', v.코드, '/documents', (v.만료일 - o.d)
from app.v_document_status v cross join 오늘 o
where v.만료일 is not null and v.상태 in ('만료', '만료임박');

comment on view app.v_calendar is
  '일정 달력. 마감·협약종료·보고예정·서류만료를 한 모양으로 모은다. '
  '색은 여기 없다 — 종류만 주고 화면이 고른다. '
  '「행동이 필요한 것만」이 기준이라 유효한 서류와 종료된 사업은 빠진다.';

-- -----------------------------------------------------------------------------
-- 4. 날짜가 없어 달력에 못 올리는 것 — 버리지 않고 옆에 세운다
--    접수기간의 56%가 날짜가 아니다. 이걸 안 만들면 관심 공고가 화면에서 사라진다.
-- -----------------------------------------------------------------------------
create or replace view app.v_calendar_undated as
select
  a.id::text                        as 참조키,
  '공고'                            as 참조종류,
  a.사업명                          as 제목,
  coalesce(a.소관부처, a.전문기관)   as 부제,
  a.마감유형                        as 사유,
  '/announcements'                  as 링크
from app.announcements a
join app.watchlist w on w.종류 = '공고' and w.참조_id = a.id
where a.접수종료 is null;

comment on view app.v_calendar_undated is
  '관심 표시했지만 마감일이 날짜가 아닌 공고(상시·소진시·선착순). '
  '달력에 못 올린다고 없애면 「모르면 모른다고 한다」 원칙이 깨진다.';

-- -----------------------------------------------------------------------------
-- 5. 권한 — 객체 단위만. 롤 DDL 은 하지 않는다
-- -----------------------------------------------------------------------------
grant select                         on app.v_calendar         to authenticated, service_role;
grant select                         on app.v_calendar_undated to authenticated, service_role;
grant select                         on app.watchlist          to authenticated;
grant select, insert, update, delete on app.watchlist          to service_role;
grant usage, select                  on sequence app.watchlist_id_seq to service_role;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop view if exists app.v_calendar_undated;
-- drop view if exists app.v_calendar;
-- drop table if exists app.watchlist;   -- v_announcement_board 가 참조하므로 아래를 먼저
-- commit;
-- ⚠ watchlist 를 지우려면 v_announcement_board 를 70_announcement_board.sql 버전으로
--    되돌린 뒤에 지운다(관심 컬럼이 watchlist 를 참조한다).
