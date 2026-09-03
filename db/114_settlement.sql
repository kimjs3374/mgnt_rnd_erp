-- 정산 마감일을 사람이 바꾼다. (2026-09-04 · mgnt2 나예찬, 사용자 지시)
--
-- 「회계 일정은 매번 달라진다」 — 그래서 **세 층**으로 둔다.
--   ① 기본 규칙: 매월 N일 · 쉬는 날이면 앞으로 당길지 뒤로 미룰지 (`settlement_rule`, 한 줄)
--   ② 그 달만 다르게: 2026-09 는 27일 (`settlement_overrides`)  ← 이게 「매번 달라진다」의 답이다
--   ③ 공휴일 목록: 음력이라 코드에 박으면 틀린다 (`holidays`)
--
-- ⚠ 코드에 박아 두면 고칠 때마다 배포해야 한다. 대회 뒤에 쓸 사람은 화면에서 고쳐야 한다.
--    그래서 규칙도 공휴일도 **데이터**로 둔다(CLAUDE.md §0.5 「사업유형은 데이터다. 코드에 박지 않는다」와 같은 태도).
--
-- ⚠ `app.projects` 처럼 남의 테이블은 안 건드린다. 전부 새 테이블이다(rnd_dev 소유).

begin;

-- ① 기본 규칙. **한 줄만 쓴다**(id=1 고정) — 회사 하나짜리 시스템이다.
create table if not exists app.settlement_rule (
  id        smallint primary key default 1,
  기준일    smallint not null default 25,
  -- '앞' = 쉬는 날이면 앞 영업일로 당긴다(주말이면 금요일이 된다)
  -- '뒤' = 다음 영업일로 미룬다 · '그대로' = 안 옮긴다
  이동      text not null default '앞',
  비고      text,
  바꾼이    text not null default '시드',
  바꾼일시  timestamptz not null default now(),
  constraint settlement_rule_한줄 check (id = 1),
  constraint settlement_rule_기준일 check (기준일 between 1 and 31),
  constraint settlement_rule_이동 check (이동 in ('앞', '뒤', '그대로'))
);

insert into app.settlement_rule (id, 기준일, 이동, 비고)
select 1, 25, '앞', '기본값 — 매월 25일, 쉬는 날이면 앞 영업일'
 where not exists (select 1 from app.settlement_rule where id = 1);

-- ② 그 달만 다르게. 회계 일정이 달마다 바뀌는 자리다.
create table if not exists app.settlement_overrides (
  연월      text primary key,          -- 'YYYY-MM'
  마감일    date not null,
  사유      text,
  바꾼이    text not null default '미상',
  바꾼일시  timestamptz not null default now(),
  constraint settlement_overrides_연월 check (연월 ~ '^\d{4}-\d{2}$')
);

-- ③ 공휴일. **음력 공휴일을 코드에 박지 않는다** — 틀리면 D-day 가 며칠씩 어긋난다.
create table if not exists app.holidays (
  날짜      date primary key,
  이름      text not null,
  -- 음력 기반이라 사람이 달력으로 확인해야 하는 것. 화면이 「확인 필요」를 띄운다.
  확인필요  boolean not null default false,
  바꾼이    text not null default '시드',
  바꾼일시  timestamptz not null default now()
);

-- 2026 고정일 공휴일(확실하다) + 음력(확인 필요로 표시)
insert into app.holidays (날짜, 이름, 확인필요) values
  ('2026-01-01', '신정', false),
  ('2026-03-01', '삼일절', false),
  ('2026-03-02', '삼일절 대체', false),
  ('2026-05-05', '어린이날', false),
  ('2026-06-06', '현충일', false),
  ('2026-08-15', '광복절', false),
  ('2026-10-03', '개천절', false),
  ('2026-10-09', '한글날', false),
  ('2026-12-25', '성탄절', false),
  ('2026-02-16', '설 연휴', true),
  ('2026-02-17', '설날', true),
  ('2026-02-18', '설 연휴', true),
  ('2026-05-24', '부처님오신날', true),
  ('2026-05-25', '부처님오신날 대체', true),
  ('2026-09-24', '추석 연휴', true),
  ('2026-09-25', '추석', true),
  ('2026-09-26', '추석 연휴', true)
on conflict (날짜) do nothing;

alter table app.settlement_rule      enable row level security;
alter table app.settlement_overrides enable row level security;
alter table app.holidays             enable row level security;

-- 읽기는 로그인한 사람 모두. 쓰기 정책은 안 만든다 — 서버 액션(service_role)만 지나간다.
drop policy if exists authenticated_read_settlement_rule on app.settlement_rule;
create policy authenticated_read_settlement_rule
  on app.settlement_rule for select to authenticated using (true);
drop policy if exists authenticated_read_settlement_overrides on app.settlement_overrides;
create policy authenticated_read_settlement_overrides
  on app.settlement_overrides for select to authenticated using (true);
drop policy if exists authenticated_read_holidays on app.holidays;
create policy authenticated_read_holidays
  on app.holidays for select to authenticated using (true);

grant select on app.settlement_rule, app.settlement_overrides, app.holidays to authenticated;

select * from app.settlement_rule;
select count(*) as 공휴일, count(*) filter (where 확인필요) as 확인필요 from app.holidays;

commit;

-- 되돌리기
--   drop table if exists app.settlement_overrides;
--   drop table if exists app.holidays;
--   drop table if exists app.settlement_rule;
