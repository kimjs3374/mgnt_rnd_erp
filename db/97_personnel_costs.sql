-- =============================================================================
-- 97_personnel_costs.sql — 개인별 인건비 계상 (연차별 · 현금/현물 구분)
--
--   무엇인가: RCMS·연구개발계획서에 넣는 **참여연구원 인건비 계상표**다. 사용자가 준 실제 양식의
--   열을 그대로 옮겼다 — 자격 · 구분(내외부) · 성명 · 연구자등록번호 · 소속기관/부서 · 직급 · 국적 ·
--   신규채용여부 · 월급여 · 참여시작일 · 참여종료일 · 참여율(%) · 참여개월수 · 지급구분 · 총액 · 급여총액.
--
--   왜 필요한가: 인건비는 비목 합계 하나로는 만들 수 없다. 사람마다 월급여·참여율·참여개월이
--   다르고, **미지급(현물)과 지급(현금)이 섞인다.** 지금까지 `budgets` 의 인건비 한 줄을
--   손으로 채우고 있었는데, 그 숫자가 어디서 나왔는지 남지 않았다. 여기서 만들어 그 줄로 보낸다.
--
--   계산은 코드가 한다(생성 열로 박지 않는다 — 양식마다 절사 규칙이 다르다).
--     총액     = 월급여 × 참여율/100 × 참여개월수   (양식 실측: 4,000,000 × 25% × 6 = 6,000,000)
--     급여총액 = 월급여 × 12                        (양식 실측: 4,000,000 × 12 = 48,000,000)
--   `lib/personnel.ts` 가 같은 식을 갖고 있고 화면에서 즉시 다시 계산한다.
--
--   ⚠ 개인정보 — 이 표는 성명·급여를 담는다. CLAUDE.md §5 절대규칙 5 가 걸리는 자리다.
--     · **실명·실제 급여를 시드하지 않는다.** 시연용 더미는 「연구원A」 같은 표시명만 쓴다.
--     · 대회 기간 공개 URL 에는 더미만 올린다. 실데이터는 로그인 게이트가 붙은 뒤에.
--     · 증빙(급여이체증·4대보험 명부)은 여전히 업로드를 막는다(`evidence_requirements.개인정보포함`).
--     그래서 컬럼 이름을 `성명` 이 아니라 `표시명` 으로 두었다 — 가명을 넣어도 어색하지 않게.
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/97_personnel_costs.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.personnel_costs (
  id             bigserial primary key,
  과제_id        bigint  not null references app.projects(id) on delete cascade,
  -- 연차. 과제가 2년이면 1·2 가 따로 계상된다(양식이 연차별 시트로 갈린다).
  연차           integer not null default 1,
  정렬           integer not null default 0,

  자격           text,                       -- 연구책임 | 참여연구원 | 연구지원 …
  내외부         text    not null default '내부',   -- 내부 | 외부
  표시명         text    not null,           -- ⚠ 실명 대신 표시명. 공개 URL 에는 가명을 쓴다
  연구자등록번호 text,
  소속기관       text,
  소속부서       text,
  직급           text,
  국적           text,
  신규채용여부   boolean not null default false,

  월급여         bigint  not null default 0,
  참여율         numeric not null default 0,  -- % (27.5 처럼 소수가 있다)
  참여개월수     numeric not null default 0,
  참여시작일     date,
  참여종료일     date,

  -- 지급 = 현금으로 나간다 · 미지급 = 현물(기관부담)로 얹는다. 양식의 「지급구분」이 그 뜻이다.
  지급구분       text    not null default '미지급',
  -- 그래서 재원구분은 지급구분에서 따라온다. 예외(출연금으로 지급)가 있어 컬럼으로 둔다.
  재원구분       text    not null default '현물',
  비고           text,
  created_at     timestamptz not null default now(),

  constraint personnel_costs_내외부_chk   check (내외부 in ('내부','외부')),
  constraint personnel_costs_지급구분_chk check (지급구분 in ('지급','미지급')),
  constraint personnel_costs_재원구분_chk check (재원구분 in ('출연금','현금','현물')),
  constraint personnel_costs_참여율_chk   check (참여율 >= 0 and 참여율 <= 100)
);

create index if not exists personnel_costs_과제_연차_idx
  on app.personnel_costs (과제_id, 연차, 정렬);

comment on table app.personnel_costs is
  '개인별 인건비 계상(연차별). 총액 = 월급여 × 참여율/100 × 참여개월수. '
  '지급=현금 · 미지급=현물. 합계는 budgets 의 PERSONNEL 줄로 반영한다(app/actions/personnel.ts). '
  '⚠ 표시명 컬럼에 실명을 넣지 않는다 — 공개 URL 에는 더미만 올린다(CLAUDE.md §5 절대규칙 5).';
comment on column app.personnel_costs.지급구분 is
  '지급 = 현금 지출(급여이체) · 미지급 = 현물 부담. 양식의 지급구분 열과 같다.';

grant select on app.personnel_costs to authenticated;
grant all    on app.personnel_costs to service_role;
grant all    on sequence app.personnel_costs_id_seq to service_role;

alter table app.personnel_costs enable row level security;
drop policy if exists authenticated_read_personnel_costs on app.personnel_costs;
create policy authenticated_read_personnel_costs
  on app.personnel_costs for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_personnel_costs on app.personnel_costs;
-- drop table if exists app.personnel_costs;
-- commit;
-- notify pgrst, 'reload schema';
