-- =============================================================================
-- 99_project_entry_log.sql — 대장 한 줄이 「어디서 들어왔는지」를 남긴다
--
--   무엇을 푸는가
--     이제 `app.projects` 에 한 줄이 생기는 길이 셋이다.
--       ① 공고 상세의 [지원 등록] (`app/actions/apply.ts`)
--       ② 시드 — 케이오시 관리대장 엑셀 12건
--       ③ **대장 화면의 [기존 사업 옮겨 담기]** ← 이번에 생긴 길
--     ①은 `공고_id` 가 있어 구분되지만 ②와 ③은 둘 다 비어 있어 구분이 안 된다.
--
--     CLAUDE.md §6-1 — **「핵심은 판정이 아니라 기록이다」.** 결과 표는 이미 엑셀에 있고
--     없는 것은 「누가·어디서 넣었는지」다. 정산 검토·현장 점검에서 대장 한 줄의 출처를
--     못 대면 그 줄은 근거가 없는 줄이다.
--
--   ⚠ 왜 `app.projects` 에 컬럼을 붙이지 않았나 — **붙일 수 없다.**
--     `app.projects` 의 소유자는 `supabase_admin` 이고 우리 개발 계정 `rnd_dev` 는
--     `must be owner of table projects` 로 막힌다(실측 2026-09-04).
--     소유권을 넘겨받는 것은 운영 DB 롤을 건드리는 일이라 하지 않는다(CLAUDE.md §5-3 —
--     롤 DDL 로 클러스터가 25초 멈춘 전력이 있다). **그래서 곁 테이블로 둔다.**
--     결과적으로도 이쪽이 낫다 — `projects` 에 뷰 6개와 웹·봇이 걸려 있어 손대지 않는 편이 안전하다.
--
--   과제 하나에 한 줄만 둔다(UNIQUE). 「어떻게 들어왔나」는 한 번뿐인 사실이다.
--   나중에 고친 이력은 여기가 아니라 별도의 변경 이력이 맡는다.
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/99_project_manual_entry.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.project_entry_log (
  과제_id   bigint primary key references app.projects(id) on delete cascade,
  -- 수기입력 | 공고지원 | 가져오기. 자유값이다 — 길이 또 생기면 낱말을 하나 늘린다.
  등록경로  text not null,
  등록자    text not null,
  등록일시  timestamptz not null default now(),
  -- 로그인 세션으로 확인된 사람인지. false 면 화면에 「미인증」으로 그대로 뜬다.
  등록자_인증 boolean not null default false,
  비고      text
);

comment on table app.project_entry_log is
  '대장 한 줄의 출처. 행이 없으면 = 이 표가 생기기 전에 만들어진 줄(시드 12건 포함)이라는 뜻이고, '
  '그것도 사실이라 뒤늦게 채우지 않는다 — 모르는 것은 모르는 채로 둔다(CLAUDE.md §6-5).';

comment on column app.project_entry_log.등록자 is
  '넣은 사람. 로그인 전이면 「미인증(로그인 전)」이 그대로 들어간다(lib/current-user.ts). '
  '화면에 그대로 표시한다 — 숨기면 대장의 출처가 흐려진다.';

create index if not exists project_entry_log_경로_idx on app.project_entry_log (등록경로);

grant select on app.project_entry_log to authenticated;
grant all    on app.project_entry_log to service_role;

alter table app.project_entry_log enable row level security;
drop policy if exists authenticated_read_project_entry_log on app.project_entry_log;
create policy authenticated_read_project_entry_log
  on app.project_entry_log for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_project_entry_log on app.project_entry_log;
-- drop table if exists app.project_entry_log;
-- commit;
-- notify pgrst, 'reload schema';
