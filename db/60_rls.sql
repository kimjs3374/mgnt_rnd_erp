-- =============================================================================
-- 60_rls.sql — RLS 활성화 + 권한 정리
--
--   배경: app 스키마 20개 테이블이 전부 RLS 꺼짐 상태였고,
--         50_program_ledger.sql 로 만든 객체 5개는 권한이 아예 없었다.
--         rnd-api.mgnt.kr 은 공개 도메인이므로 이 상태를 방치하면 안 된다.
--
--   설계
--     ① 뷰를 security_invoker 로 바꾼다. 안 그러면 뷰가 RLS 를 우회한다 —
--        뷰 소유자(postgres)의 권한으로 실행되기 때문이다. 이게 가장 큰 구멍이었다.
--     ② anon 에는 아무 권한도 주지 않는다. 로그인이 붙기 전까지 anon = 인터넷 전체다.
--        공고 화면(비로그인 공개)이 생기면 announcements 만 따로 연다.
--     ③ authenticated 는 읽기만. 쓰기는 service_role 이 서버에서 한다.
--     ④ service_role 은 bypassrls=true 라 정책과 무관하게 통과한다. 확인 완료.
--
--   적용:    docker exec -i rnd-db psql -U postgres -d postgres < 60_rls.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 새로 만든 객체의 권한을 기존 객체와 맞춘다
--    기존: authenticated=SELECT · service_role=ALL · supabase_admin=ALL
-- -----------------------------------------------------------------------------
grant select on
  app.funding_schemes, app.program_documents, app.program_checks,
  app.eligibility_decisions, app.v_program_ledger
  to authenticated;

grant all on
  app.funding_schemes, app.program_documents, app.program_checks,
  app.eligibility_decisions, app.v_program_ledger
  to service_role;

grant usage, select on all sequences in schema app to service_role;

-- -----------------------------------------------------------------------------
-- 2. ★ 뷰를 security_invoker 로 — 이게 없으면 RLS 를 켜도 뷰로 다 새어 나간다
-- -----------------------------------------------------------------------------
alter view app.v_program_ledger    set (security_invoker = on);
alter view app.v_budget_status     set (security_invoker = on);
alter view app.v_document_status   set (security_invoker = on);
alter view app.v_evidence_check    set (security_invoker = on);
alter view app.v_evidence_summary  set (security_invoker = on);
alter view app.v_settlement_status set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- 3. anon 을 명시적으로 막는다
--    지금은 grant 가 없어 401 이 나지만, 나중에 누가 무심코 열지 않도록 못을 박는다.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema app from anon;
alter default privileges in schema app revoke all on tables from anon;

-- -----------------------------------------------------------------------------
-- 4. RLS 활성화 + 읽기 정책
--    테이블마다 같은 정책이라 반복문으로 건다. 새 테이블이 생겨도 이 블록을 다시 돌리면 된다.
-- -----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r'
    order by c.relname
  loop
    execute format('alter table app.%I enable row level security', t.relname);

    -- 정책을 다시 만들 수 있게 먼저 지운다 (재실행 가능하게)
    execute format('drop policy if exists %I on app.%I',
                   'authenticated_read_' || t.relname, t.relname);

    execute format(
      'create policy %I on app.%I for select to authenticated using (true)',
      'authenticated_read_' || t.relname, t.relname);
  end loop;
end
$$;

-- 정책 요약을 남긴다.
comment on schema app is
  'RLS 활성 (2026-09-03). authenticated=읽기전용 · service_role=bypassrls · anon=차단. '
  '뷰는 security_invoker 라 RLS 가 뷰를 통해서도 적용된다. '
  '⚠ 쓰기는 서버(service_role)에서만 한다. 로그인이 붙으면 authenticated 쓰기 정책을 따로 설계할 것.';

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- do $$ declare t record; begin
--   for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--            where n.nspname='app' and c.relkind='r' loop
--     execute format('drop policy if exists %I on app.%I', 'authenticated_read_'||t.relname, t.relname);
--     execute format('alter table app.%I disable row level security', t.relname);
--   end loop;
-- end $$;
-- alter view app.v_program_ledger    set (security_invoker = off);
-- alter view app.v_budget_status     set (security_invoker = off);
-- alter view app.v_document_status   set (security_invoker = off);
-- alter view app.v_evidence_check    set (security_invoker = off);
-- alter view app.v_evidence_summary  set (security_invoker = off);
-- alter view app.v_settlement_status set (security_invoker = off);
-- commit;
