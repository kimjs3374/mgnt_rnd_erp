-- =============================================================================
-- 100_budget_confirmations.sql — 계상 확정 · 해제 이력
--
--   무엇을 푸는가
--     연구비 계상 탭은 **계상하는 자리**다. 다 잡고 나면 그 과제의 관리 위치는 대장으로 넘어가고,
--     계상 탭은 **볼 수만 있어야 한다.** 확정 뒤에도 배정액을 고칠 수 있으면
--     정산 대조 기준(`정산` 탭의 과제비 원장이 배정액을 기준으로 집행과 맞춘다)이 조용히 바뀐다.
--
--   왜 상태 컬럼이 아니라 **이력 표**인가
--     ① `app.projects` 는 소유자가 `supabase_admin` 이라 컬럼을 못 붙인다
--        (`must be owner of table projects` — `_팀로그/memory/table-ownership-alter.md`).
--     ② 그보다 중요한 이유 — **CLAUDE.md §6-1 「핵심은 판정이 아니라 기록이다」.**
--        확정을 풀었다면 「누가 언제 왜 풀었는지」가 남아야 한다. 상태 컬럼 하나면 그게 사라진다.
--        정정에 사유를 필수로 받는 것과 같은 자리다.
--
--   현재 상태 = 그 과제의 **가장 최근 행의 동작**. 확정이면 잠기고, 해제면 다시 열린다.
--
--   ⚠ 확정 시점의 금액을 박제한다(`총사업비_스냅샷` · `배정합_스냅샷`).
--     나중에 총사업비가 바뀌면 「확정할 때와 다르다」를 말할 수 있어야 한다.
--     스냅샷이 없으면 어긋난 사실 자체를 알 수 없다.
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/100_budget_confirmations.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.budget_confirmations (
  id              bigserial primary key,
  과제_id         bigint not null references app.projects(id) on delete cascade,
  동작            text   not null,
  -- 해제할 때는 사유가 없으면 저장되지 않는다. 정정 사유를 필수로 받는 것과 같은 규칙이다.
  사유            text,
  총사업비_스냅샷 bigint,
  배정합_스냅샷   bigint,
  행위자          text   not null,
  행위자_인증     boolean not null default false,
  일시            timestamptz not null default now(),

  constraint budget_confirmations_동작_chk check (동작 in ('확정', '해제')),
  constraint budget_confirmations_해제사유_필수
    check (동작 <> '해제' or (사유 is not null and length(btrim(사유)) > 0))
);

-- 「이 과제의 최신 행」을 뽑는 조회가 전부다.
create index if not exists budget_confirmations_과제_idx
  on app.budget_confirmations (과제_id, 일시 desc);

comment on table app.budget_confirmations is
  '계상 확정·해제 이력. 현재 상태는 과제별 최신 행의 동작이다. '
  '확정되면 계상 탭이 읽기 전용이 되고 관리 위치가 사업 대장으로 넘어간다.';

comment on column app.budget_confirmations.총사업비_스냅샷 is
  '확정 시점의 총사업비. 나중에 협약이 바뀌면 「확정할 때와 다르다」를 말할 수 있어야 한다.';

grant select on app.budget_confirmations to authenticated;
grant all    on app.budget_confirmations to service_role;
grant all    on sequence app.budget_confirmations_id_seq to service_role;

alter table app.budget_confirmations enable row level security;
drop policy if exists authenticated_read_budget_confirmations on app.budget_confirmations;
create policy authenticated_read_budget_confirmations
  on app.budget_confirmations for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_budget_confirmations on app.budget_confirmations;
-- drop table if exists app.budget_confirmations;
-- commit;
-- notify pgrst, 'reload schema';
