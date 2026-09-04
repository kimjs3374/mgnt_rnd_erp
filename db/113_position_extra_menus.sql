-- =============================================================================
-- 113_position_extra_menus.sql — 임원진 부서 · 직급 · 개인 추가 메뉴 권한
--
--   department에 'executive'(임원진) 추가 — 연구소·기획실과 동급, 예외 없이
--   자기 부서 메뉴만 기본으로 본다(2026-09-04 사용자 결정 — 임원진도 특별 취급 안 함).
--
--   position(직급)은 부서별로 정해진 값만 쓴다(화면에서 강제, DB는 자유 텍스트로 둔다 —
--   부서마다 다른 목록이라 하나의 CHECK로 묶기 애매하고, 목록이 바뀔 수 있어서 유연하게 둔다).
--
--   extra_menus는 "이 사람에게만 예외로 열어주는 메뉴 트랙"이다(research·planning만 —
--   계정 관리는 등급 기준 보안 경계라 여기 포함 안 함).
--
--   적용:    db/psql.sh -f db/113_position_extra_menus.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

alter table app.users drop constraint users_department_check;
alter table app.users add constraint users_department_check
  check (department is null or department in ('research', 'planning', 'executive'));

alter table app.users add column if not exists position text;
alter table app.users add column if not exists extra_menus text[] not null default '{}';

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- alter table app.users drop column if exists extra_menus;
-- alter table app.users drop column if exists position;
-- update app.users set department = null where department = 'executive';
-- alter table app.users drop constraint users_department_check;
-- alter table app.users add constraint users_department_check
--   check (department is null or department in ('research', 'planning'));
-- commit;
