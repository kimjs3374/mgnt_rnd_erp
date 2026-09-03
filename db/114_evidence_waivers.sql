-- =============================================================================
-- 114_evidence_waivers.sql — 증빙 **면제**(강제 정상 처리)와 그 이력
--
--   무엇을 푸는가 (2026-09-04 사용자 지시)
--     「사업비 증빙 미비」에 실제로는 **문제가 아닌 건**이 섞인다 —
--     거래 성격상 그 서류가 없는 경우(수의계약이라 견적의뢰서가 없다 · 무상 제공이라
--     세금계산서가 없다 · 사업주체가 그 서류를 안 받는다). 그걸 못 지우면 그 카드가
--     「늘 빨간 숫자」가 되어 아무도 안 본다.
--     그래서 **강제로 정상 처리**할 수 있게 한다. 대신 **사유를 반드시 적고 기록에 남긴다.**
--
--   ★ 왜 「없는 것을 있다고」 하지 않는가
--     증빙 파일 행을 가짜로 만들면 정산 실사에서 파일을 못 내놓는다. 그건 거짓 기록이다.
--     면제는 **「이 칸은 이 사유로 비워 둔다」는 사람의 판단**이고, 그 판단을 그대로 남긴다
--     (CLAUDE.md §6-1 「핵심은 판정이 아니라 기록이다」).
--     화면의 미비 숫자에서는 빠지지만, **면제 건수와 사유는 따로 보인다.**
--
--   왜 이력을 쌓는가 (`동작` = 면제 | 해제)
--     `app.budget_confirmations`(db/100)와 같은 방식이다. 상태를 한 줄에 덮어쓰면
--     「누가 왜 면제했다가 왜 되돌렸는지」가 사라진다. 현재 상태는 (집행, 요건)별 **가장 최근 행**이다.
--
--   설계 원칙: 추가만. 적용: cd /web/rnd && ./db/psql.sh -f db/114_evidence_waivers.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.evidence_waivers (
  id          bigserial primary key,

  집행_id     bigint not null references app.expenses(id) on delete cascade,
  -- 어느 서류 칸인가. 요건 표(`app.evidence_requirements`)의 그 줄이다.
  요건_id     bigint not null references app.evidence_requirements(id) on delete cascade,

  동작        text   not null,          -- 면제 | 해제
  -- ★ 사유는 **필수**다. 빈 사유로 면제하면 나중에 아무도 왜 그랬는지 모른다.
  사유        text   not null,
  -- 흔한 사유를 골라 담는 칸(자유값). 통계로 「어느 서류가 왜 자주 빠지나」를 보게 된다.
  사유유형    text,

  행위자      text   not null,
  행위자_인증 boolean not null default false,
  일시        timestamptz not null default now(),

  constraint evidence_waivers_동작_chk check (동작 in ('면제', '해제')),
  -- 공백만 넣는 것도 막는다. 화면에서 막고 DB 가 마지막으로 막는다.
  constraint evidence_waivers_사유_chk check (btrim(사유) <> '')
);

create index if not exists evidence_waivers_칸_idx
  on app.evidence_waivers (집행_id, 요건_id, 일시 desc);

comment on table app.evidence_waivers is
  '증빙 면제(강제 정상 처리)와 그 이력. 동작=면제|해제 를 쌓는다 — 현재 상태는 (집행,요건)별 최신 행. '
  '증빙 파일을 가짜로 만들지 않는 이유는 정산 실사에서 파일을 못 내놓기 때문이다. '
  '면제는 사람의 판단이고 사유와 함께 남는다.';
comment on column app.evidence_waivers.사유 is
  '필수. 예: 수의계약이라 견적의뢰서가 없음 · 무상 제공이라 세금계산서 없음 · 사업주체가 요구하지 않음.';

grant select on app.evidence_waivers to authenticated;
grant all    on app.evidence_waivers to service_role;
grant all    on sequence app.evidence_waivers_id_seq to service_role;

alter table app.evidence_waivers enable row level security;
drop policy if exists authenticated_read_evidence_waivers on app.evidence_waivers;
create policy authenticated_read_evidence_waivers
  on app.evidence_waivers for select to authenticated using (true);

-- (집행, 요건)별 **현재 면제 상태**. 화면·집계가 이걸 본다.
create or replace view app.v_evidence_waiver_now as
select w.집행_id, w.요건_id, w.동작, w.사유, w.사유유형, w.행위자, w.일시
  from app.evidence_waivers w
  join (
    select 집행_id, 요건_id, max(일시) as 최신
      from app.evidence_waivers group by 1, 2
  ) m on m.집행_id = w.집행_id and m.요건_id = w.요건_id and m.최신 = w.일시
 where w.동작 = '면제';

comment on view app.v_evidence_waiver_now is
  '지금 면제 상태인 (집행, 요건) 칸만. 해제된 칸은 최신 행이 「해제」라 여기 안 나온다.';

grant select on app.v_evidence_waiver_now to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop view if exists app.v_evidence_waiver_now;
-- drop policy if exists authenticated_read_evidence_waivers on app.evidence_waivers;
-- drop table if exists app.evidence_waivers;
-- commit;
-- notify pgrst, 'reload schema';
