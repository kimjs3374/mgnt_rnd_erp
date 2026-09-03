-- =============================================================================
-- 80_dev_role.sql — 팀원 전원이 DDL·SQL 을 직접 돌릴 수 있게 한다
--
--   그동안 스키마 변경은 김정수만 했다. 「스키마가 네 명 사이의 계약서」라서였다.
--   그 이유는 여전히 유효하지만, 한 사람이 병목이 되는 대가가 더 크다는 판단이다.
--   → 권한은 열되, **규율은 CLAUDE.md §3.5 로 옮긴다.**
--
--   설계
--     · docker 그룹도 sudo 도 주지 않는다. docker 그룹은 사실상 root 다.
--       대신 DB 롤 하나를 파고 컨테이너 IP 로 직접 붙게 한다.
--     · BYPASSRLS 를 준다. 정책에 막혀 개발이 멈추면 안 된다.
--       운영 경로(웹·봇)는 여전히 service_role / rnd_mcp 를 쓴다.
--     · **새로 만든 객체가 웹·봇에 안 보이면 소용없다.**
--       기본 권한을 걸어 rnd_dev 가 만든 것이 자동으로 공유되게 한다.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rnd_dev') then
    create role rnd_dev login;
  end if;
end
$$;

alter role rnd_dev bypassrls nosuperuser nocreatedb nocreaterole inherit;

-- 스키마에 만들 수 있게
grant usage, create on schema app to rnd_dev;
grant usage on schema public, storage to rnd_dev;

-- 기존 객체 전부
grant all on all tables    in schema app to rnd_dev;
grant all on all sequences in schema app to rnd_dev;
grant all on all functions in schema app to rnd_dev;

-- ★ rnd_dev 가 앞으로 만들 것이 웹·봇에 자동으로 보이게 한다.
--   이게 없으면 mgnt1 이 만든 테이블을 웹이 못 읽고, 원인 찾는 데 시간이 날아간다.
alter default privileges for role rnd_dev in schema app
  grant all on tables to service_role, postgres;
alter default privileges for role rnd_dev in schema app
  grant select on tables to authenticated;
alter default privileges for role rnd_dev in schema app
  grant all on sequences to service_role, postgres;
alter default privileges for role rnd_dev in schema app
  grant usage, select on sequences to authenticated;

-- 반대 방향도. postgres 가 만든 것을 rnd_dev 가 만질 수 있게.
alter default privileges for role postgres in schema app
  grant all on tables to rnd_dev;
alter default privileges for role postgres in schema app
  grant all on sequences to rnd_dev;

-- anon 은 여전히 아무것도 못 받는다.
alter default privileges for role rnd_dev in schema app revoke all on tables from anon;

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- alter default privileges for role rnd_dev in schema app revoke all on tables from service_role, postgres, authenticated;
-- alter default privileges for role postgres in schema app revoke all on tables from rnd_dev;
-- revoke all on all tables in schema app from rnd_dev;
-- revoke all on schema app from rnd_dev;
-- drop role if exists rnd_dev;
-- commit;
