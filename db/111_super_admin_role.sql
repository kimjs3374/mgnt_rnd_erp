-- =============================================================================
-- 111_super_admin_role.sql — 등급을 셋으로 나눈다: 슈퍼관리자 > 관리자 > 일반회원
--
--   슈퍼관리자는 모든 권한을 가진 마스터다. 관리자는 슈퍼관리자가 정해주는 등급이라
--   그 자체로는 계정 관리(승인·권한부여·정지) 화면에 접근하지 못한다 — 그건 슈퍼관리자만 한다.
--
--   슈퍼관리자 지정은 이 파일처럼 DB에서 직접 하는 것으로 남겨둔다(화면에 버튼을 안 둔다) —
--   "모든 권한을 가진 마스터"를 버튼 한 번으로 넘길 수 있게 만들면 사고 위험이 크다.
--
--   기존에 role='admin'이었던 두 계정 중 실제로 계정 관리를 담당하던 magnatech를
--   슈퍼관리자로 올린다. judge(심사용)는 관리자로 남는다 — 심사에는 로그인만 필요하고
--   계정 관리 권한까지는 필요 없다(최소 권한 원칙).
--
--   적용:    db/psql.sh -f db/111_super_admin_role.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

alter table app.users drop constraint users_role_check;
alter table app.users add constraint users_role_check
  check (role in ('member', 'admin', 'super_admin'));

update app.users set role = 'super_admin' where username = 'magnatech';

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- update app.users set role = 'admin' where role = 'super_admin';
-- alter table app.users drop constraint users_role_check;
-- alter table app.users add constraint users_role_check check (role in ('member', 'admin'));
-- commit;
