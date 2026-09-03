-- 내부 연구원 명부. (2026-09-04 · mgnt2 나예찬, 사용자 지시)
--
-- 왜 과제 밖에 두는가: **여러 과제가 같은 사람을 쓴다.** 과제 안에만 두면 같은 사람의
-- 이름·연구자등록번호·연봉을 과제마다 다시 친다(업체 대장을 회사 밑에 둔 것과 같은 이유).
-- 여기서 한 번 등록하고, 인건비 계상에서는 **골라 넣는다**.
--
-- 연봉이 여기 있는 이유: 인건비 계상은 **월급여**를 쓴다. 월급여 = 연봉 ÷ 12.
-- 사용자 표현 그대로 「대략적인 연봉, 1년 단위 업데이트」라 **연도별 이력**을 따로 둔다 —
-- 2024년 계상은 2024년 연봉으로 해야 하고, 올해 연봉으로 덮으면 지난 계상의 근거가 사라진다.
--
-- ⚠ 개인정보 (CLAUDE.md §5 절대규칙 5). 이 표는 **이름·연구자등록번호·입사일·연봉**이라
--    성격상 개인정보 그 자체다. 그래서 `app.personnel_costs` 와 **똑같은 방식**으로 다룬다:
--      · 컬럼 이름을 `성명` 이 아니라 **`표시명`** 으로 둔다(가명을 쓰라는 신호)
--      · 시드는 **표준 더미(홍길동)뿐**이고 실명·실연봉을 넣지 않는다
--      · 화면에 「공개 주소에는 가명을 쓰세요」를 띄운다
--      · 쓰기 정책을 만들지 않는다 — 서버 액션(service_role)만 지나간다
--    실제 값은 로그인 게이트가 붙은 뒤에 사람이 넣는다. 막지는 않는다 — 막으면 못 쓰는 기능이다.
--
-- ⚠ `app.projects` 처럼 남의 소유 테이블을 고치지 않는다. 전부 새 테이블이다(rnd_dev 소유).

begin;

create table if not exists app.researchers (
  id             bigserial primary key,
  표시명         text not null,
  연구자등록번호 text,
  입사일자       date,
  소속기관       text,
  소속부서       text,
  직급           text,
  -- 계상표의 「구분(내외부)」에 그대로 들어간다. 내부가 기본 — 이 표가 내부 연구원 명부다.
  내외부         text not null default '내부',
  국적           text,
  -- 지금 연봉과 그 기준연도. 이력은 아래 표에 쌓인다.
  연봉           bigint not null default 0,
  연봉_기준연도  integer,
  재직           boolean not null default true,
  비고           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint researchers_내외부_chk check (내외부 in ('내부', '외부'))
);

comment on column app.researchers.표시명 is
  '연구원 표시명. 공개 URL 에 실명을 넣지 않는다 — personnel_costs.표시명 과 같은 규칙.';
comment on column app.researchers.연봉 is
  '대략적인 연봉. 월급여 = 연봉 / 12 로 인건비 계상에 들어간다. 연도별 이력은 researcher_salaries.';

-- 같은 사람을 두 번 등록하는 것을 막는다. 번호가 없는 사람도 있어서 NULL 은 허용한다.
create unique index if not exists researchers_등록번호_uniq
  on app.researchers ("연구자등록번호")
  where "연구자등록번호" is not null and "연구자등록번호" <> '';

-- 연도별 연봉. **덮어쓰지 않고 쌓는다** — 지난 계상의 근거가 그 해 연봉이기 때문이다.
create table if not exists app.researcher_salaries (
  연구원_id  bigint not null references app.researchers(id) on delete cascade,
  연도       integer not null,
  연봉       bigint not null,
  바꾼이     text not null default '미상',
  바꾼일시   timestamptz not null default now(),
  primary key ("연구원_id", "연도")
);

alter table app.researchers        enable row level security;
alter table app.researcher_salaries enable row level security;

-- 읽기는 로그인한 사람 모두. **쓰기 정책은 만들지 않는다** — service_role(서버 액션)만 지나간다
-- (`db/70_storage_rls.sql` 과 같은 태도).
drop policy if exists authenticated_read_researchers on app.researchers;
create policy authenticated_read_researchers
  on app.researchers for select to authenticated using (true);

drop policy if exists authenticated_read_researcher_salaries on app.researcher_salaries;
create policy authenticated_read_researcher_salaries
  on app.researcher_salaries for select to authenticated using (true);

grant select on app.researchers, app.researcher_salaries to authenticated;
grant usage, select on sequence app.researchers_id_seq to authenticated;

-- 시드 — 표준 더미 한 명만. 실명·실연봉을 넣지 않는다.
insert into app.researchers ("표시명", "연구자등록번호", "입사일자", "소속기관", "소속부서", "직급", "연봉", "연봉_기준연도")
select '홍길동', 'R-0000001', date '2022-03-02', '매그나텍', '연구소', '책임연구원', 48000000, 2026
 where not exists (select 1 from app.researchers);

insert into app.researcher_salaries ("연구원_id", "연도", "연봉", "바꾼이")
select r.id, r."연봉_기준연도", r."연봉", '시드(db/105)'
  from app.researchers r
 where r."연봉_기준연도" is not null
 on conflict ("연구원_id", "연도") do nothing;

select id, 표시명, 연구자등록번호, 입사일자, 연봉, 연봉_기준연도 from app.researchers order by id;

commit;

-- 되돌리기
--   drop table if exists app.researcher_salaries;
--   drop table if exists app.researchers;
