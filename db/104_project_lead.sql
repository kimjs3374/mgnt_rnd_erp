-- 과제마다 연구책임자를 둔다. (2026-09-03 · mgnt2 나예찬, 사용자 지시)
--
-- ⚠ **`app.projects` 에 컬럼을 못 붙인다.** 그 테이블 소유자는 `supabase_admin` 이고
--    우리는 `rnd_dev` 라 `alter table ... add column` 이 `must be owner of table projects` 로 막힌다.
--    (`personnel_costs` · `project_entry_log` · `rule_documents` 가 전부 옆 테이블인 이유가 이것이다.)
--    그래서 **1:1 옆 테이블**로 붙인다. 컬럼을 못 붙이는 것이지 확장을 못 하는 게 아니다.
--
-- 왜 값 하나가 아니라 이력까지 두는가:
--   사용자가 「중간에 변경될 수도 있으니 수정할 수 있게, 나중에 권한을 주기 위함」이라고 했다.
--   책임자 변경은 **협약 변경 사유**다. 누가 언제 누구로 바꿨는지를 못 대면 그 줄은 근거가 없다
--   (CLAUDE.md §6-1 「핵심은 판정이 아니라 기록이다」). 권한도 결국 「누가 바꿀 수 있나」인데
--   바꾼 사람을 안 남기면 권한을 붙여도 확인할 방법이 없다.
--
-- ⚠ 개인정보: 이 값은 **사람 이름**이다. 저장소는 공개고 배포 URL 도 열려 있다(절대규칙 5).
--    시드는 표준 더미 **홍길동**만 넣는다. 실명은 로그인 게이트 뒤에서 사람이 직접 넣는다.
--    화면에도 「공개 주소에는 가명을 쓰세요」를 띄운다 — `app.personnel_costs.표시명` 과 같은 처리다.

begin;

-- 지금 값. 과제 하나에 한 줄(1:1).
create table if not exists app.project_leads (
  과제_id     bigint primary key references app.projects(id) on delete cascade,
  표시명      text not null,
  바꾼이      text not null,
  -- 로그인 게이트가 아직 없다. 세션으로 확인된 사람인지 남겨 두면
  -- 권한이 붙은 뒤에 「누가 진짜였나」를 가려낼 수 있다(lib/current-user.ts 와 같은 뜻).
  바꾼이_인증 boolean not null default false,
  바꾼일시    timestamptz not null default now()
);

comment on column app.project_leads.표시명 is
  '연구책임자 표시명. 공개 URL 에 실명을 넣지 않는다. 변경 이력은 app.project_lead_log.';

-- 바뀐 자취. 지금 값은 위에, 어떻게 여기까지 왔는지는 여기에.
create table if not exists app.project_lead_log (
  id          bigserial primary key,
  과제_id     bigint not null references app.projects(id) on delete cascade,
  이전        text,
  이후        text not null,
  바꾼이      text not null,
  바꾼이_인증 boolean not null default false,
  사유        text,
  바꾼일시    timestamptz not null default now()
);

create index if not exists project_lead_log_과제_idx
  on app.project_lead_log ("과제_id", "바꾼일시" desc);

alter table app.project_leads    enable row level security;
alter table app.project_lead_log enable row level security;

-- 읽기는 로그인한 사람 모두. **쓰기 정책은 만들지 않는다** —
-- `db/70_storage_rls.sql` 과 같은 태도로 쓰기는 service_role(서버 액션)만 지나가게 둔다.
-- 권한을 붙일 자리도 서버 액션 한 곳이다(`app/actions/project-lead.ts`).
drop policy if exists authenticated_read_project_leads on app.project_leads;
create policy authenticated_read_project_leads
  on app.project_leads for select to authenticated using (true);

drop policy if exists authenticated_read_project_lead_log on app.project_lead_log;
create policy authenticated_read_project_lead_log
  on app.project_lead_log for select to authenticated using (true);

grant select on app.project_leads, app.project_lead_log to authenticated;

-- 시드 — 표준 더미 이름만. 이미 값이 있는 줄은 건드리지 않는다(멱등).
insert into app.project_leads ("과제_id", "표시명", "바꾼이", "바꾼이_인증")
select p.id, '홍길동', '시드(db/104)', false
  from app.projects p
 on conflict ("과제_id") do nothing;

select p.id, p.과제코드, l.표시명 as 연구책임자
  from app.projects p
  left join app.project_leads l on l."과제_id" = p.id
 order by p.id;

commit;

-- 되돌리기
--   drop table if exists app.project_lead_log;
--   drop table if exists app.project_leads;
