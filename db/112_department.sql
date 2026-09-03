-- =============================================================================
-- 112_department.sql — 부서(연구소/기획실) — 메뉴를 가르는 축
--
--   role(슈퍼관리자>관리자>일반회원)과는 다른 축이다. role은 "무엇을 할 수 있는가",
--   department는 "어떤 업무 화면을 보는가"다. 한 사람이 관리자이면서 연구소 소속일 수 있다.
--
--   계정 신청 때 본인이 고르고, 슈퍼관리자가 계정 관리 화면에서 나중에 고칠 수 있다.
--   슈퍼관리자는 department와 무관하게 항상 전체를 본다(app-sidebar.tsx·middleware.ts에서 처리).
--
--   적용:    db/psql.sh -f db/112_department.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

alter table app.users add column if not exists department text;
alter table app.users add constraint users_department_check
  check (department is null or department in ('research', 'planning'));
-- research = 연구소(과제사업·과제 관리) · planning = 기획실(지원사업)

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- alter table app.users drop constraint if exists users_department_check;
-- alter table app.users drop column if exists department;
-- commit;
