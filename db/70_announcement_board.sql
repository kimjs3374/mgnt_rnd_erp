-- =============================================================================
-- 70_announcement_board.sql — 공고 확인 보드 (과제 / 지원사업)
--
--   2026-09-03 작성·적용. 대시보드의 「공고 확인」 탭이 읽는 뷰를 만든다.
--
-- 왜 필요한가
--   케이오시 현안 1번이 「매일 여러 기관 홈페이지를 확인해 엑셀에 수기 정리」다.
--   그 화면이 답하려면 두 가지가 있어야 하는데 announcements 에 둘 다 없었다:
--     ① 과제(국가 R&D)와 지원사업(지자체·TP)을 가르는 축
--     ② 「오늘 새로 올라왔는가」를 말할 수 있는 날짜
--   ①은 이미 app.funding_schemes 에 NATIONAL_RND / LOCAL_TP 로 서 있다.
--   공고가 그걸 물게 하고, 탭 이름은 funding_schemes 에 데이터로 둔다.
--
-- 설계 원칙
--   ① 추가만 한다. DROP 도 ALTER TYPE 도 롤 DDL 도 없다. 기존 2건은 그대로 산다.
--   ② 탭 구분을 코드에 박지 않는다. funding_schemes.대분류 가 단일 진실이다.
--      (CLAUDE.md §5 — 사업유형은 데이터다)
--   ③ 날짜를 지어내지 않는다. 공고일이 없으면 수집일(created_at)로 갈음하되
--      뷰가 어느 쪽을 썼는지(날짜출처)를 같이 내보내 화면이 정직하게 표시하게 한다.
--   ④ DB TimeZone 이 UTC 다. 「오늘」은 반드시 Asia/Seoul 로 환산한다.
--      안 그러면 한국시간 09:00 이전에 올라온 공고가 어제 것으로 찍힌다.
--
-- 적용: Studio pg-meta 로 실행함 (mgnt1 은 docker·psql·DB 비번이 없다)
-- 되돌리기: 파일 맨 아래 ROLLBACK 블록
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 탭 구분을 데이터로 둔다
--    화면의 탭 이름이 여기서 나온다. 새 사업유형이 생기면 이 한 칸만 채우면 된다.
-- -----------------------------------------------------------------------------
alter table app.funding_schemes
  add column if not exists 대분류 text;

comment on column app.funding_schemes.대분류 is
  '공고 확인 화면의 탭. 과제 | 지원사업. 비우면 화면에서 「미분류」로 모인다 — '
  '모르는 것을 아는 척하지 않기 위해 기본값을 두지 않는다.';

update app.funding_schemes set 대분류 = '과제'     where 코드 = 'NATIONAL_RND' and 대분류 is null;
update app.funding_schemes set 대분류 = '지원사업' where 코드 = 'LOCAL_TP'     and 대분류 is null;

-- -----------------------------------------------------------------------------
-- 2. 공고에 사업유형과 공고일을 붙인다
-- -----------------------------------------------------------------------------
alter table app.announcements
  add column if not exists 사업유형 text references app.funding_schemes(코드),
  add column if not exists 공고일   date;

comment on column app.announcements.사업유형 is
  'funding_schemes.코드. 오픈 API 수집분은 대개 비어 있다 — 비면 「미분류」다. 추측해서 채우지 않는다.';
comment on column app.announcements.공고일 is
  '공고가 게시된 날. API 가 안 주면 null 로 둔다. created_at(우리가 수집한 시각)과 다른 것이다.';

create index if not exists idx_ann_사업유형 on app.announcements (사업유형);
create index if not exists idx_ann_공고일   on app.announcements (공고일 desc);

-- 기존 2건은 둘 다 중앙부처 R&D 시행계획 공고다(중기부·TIPA / 산업부·KEIT).
-- 사업명·소관부처로 확정되는 것이라 추측이 아니다.
update app.announcements set 사업유형 = 'NATIONAL_RND'
 where 사업유형 is null and 출처_id in ('BIZ-2026-0417', 'BIZ-2026-0521');

-- -----------------------------------------------------------------------------
-- 3. 공고 확인 보드 뷰 — 화면은 이 뷰 하나만 읽는다
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
  -- 화면이 「공고일 2026-09-03」과 「수집일 2026-09-03」을 구분해 쓸 수 있게 한다
  case when a.공고일 is not null then '공고일' else '수집일' end as 날짜출처,
  coalesce(a.공고일, (a.created_at at time zone 'Asia/Seoul')::date) as 기준일,

  -- ★ NEW 배지. 한국시간 기준 오늘.
  coalesce(a.공고일, (a.created_at at time zone 'Asia/Seoul')::date)
    = (now() at time zone 'Asia/Seoul')::date            as 신규,

  a.접수시작,
  a.접수종료,
  a.마감유형,
  -- 접수기간의 56%가 날짜가 아니다. 날짜가 없으면 D-day 도 없다. 지어내지 않는다.
  case when a.접수종료 is not null
       then a.접수종료 - (now() at time zone 'Asia/Seoul')::date end as d_day,

  a.파싱상태,
  a.공고문_url,
  a.created_at
from app.announcements a
left join app.funding_schemes fs on fs.코드 = a.사업유형;

comment on view app.v_announcement_board is
  '공고 확인 보드. 대시보드·공고탐색 화면이 읽는 단일 뷰. '
  '구분(과제|지원사업|미분류)으로 탭을 나누고 신규=true 에 NEW 배지를 단다. '
  '「미분류」는 실패가 아니라 정직한 상태다 — 오픈 API 는 사업유형을 주지 않는다.';

-- -----------------------------------------------------------------------------
-- 4. 권한 — 객체 단위만. 롤 DDL 은 하지 않는다(예전에 클러스터가 25초 멈췄다)
-- -----------------------------------------------------------------------------
grant select on app.v_announcement_board to authenticated;
grant select on app.v_announcement_board to service_role;

commit;

-- PostgREST 가 새 컬럼·뷰를 보게 한다. 이걸 빠뜨리면 화면이 계속 빈 채로 뜬다.
notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop view if exists app.v_announcement_board;
-- drop index if exists app.idx_ann_사업유형;
-- drop index if exists app.idx_ann_공고일;
-- alter table app.announcements drop column if exists 사업유형, drop column if exists 공고일;
-- alter table app.funding_schemes drop column if exists 대분류;
-- commit;
-- notify pgrst, 'reload schema';
