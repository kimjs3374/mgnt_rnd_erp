-- =============================================================================
-- 110_user_status_and_role_log.sql — 계정 정지 상태 + 역할 변경 이력
--
--   계정 정지: status 체크 제약에 'suspended'를 추가한다(기존 값은 안 건드림 — 추가만).
--   역할 변경 이력: 별도 테이블. app.users는 role의 "지금 값"만 갖고 있어서
--   "누가 언제 무엇에서 무엇으로 바꿨는지"는 따로 안 남으면 사라진다.
--
--   적용:    db/psql.sh -f db/110_user_status_and_role_log.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

alter table app.users drop constraint users_status_check;
alter table app.users add constraint users_status_check
  check (status in ('pending', 'approved', 'rejected', 'suspended'));

create table app.role_change_log (
  id          bigserial primary key,
  user_id     bigint not null references app.users(id),
  old_role    text not null,
  new_role    text not null,
  changed_by  bigint not null references app.users(id),
  changed_at  timestamptz not null default now()
);

alter table app.role_change_log enable row level security;
-- 정책 없음 → anon·authenticated 차단, service_role만 접근(bypassrls).
revoke all on app.role_change_log from anon, authenticated;
grant all on app.role_change_log to service_role;
grant usage, select on sequence app.role_change_log_id_seq to service_role;

comment on table app.role_change_log is
  '누가 누구의 역할을 언제 무엇에서 무엇으로 바꿨는지. app.users.role은 지금 값만 갖는다.';

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop table if exists app.role_change_log;
-- alter table app.users drop constraint users_status_check;
-- alter table app.users add constraint users_status_check
--   check (status in ('pending', 'approved', 'rejected'));
-- commit;
