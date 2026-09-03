-- =============================================================================
-- 112_new_hire_rules.sql — 「신규채용」 판정 기준(입사 후 몇 년까지)
--
--   무엇을 푸는가 (2026-09-04 사용자 지시)
--     연구개발계획서 인건비 표의 **신규채용여부**를 사람이 매번 손으로 켰다.
--     기준은 「**공고일 기준 입사일이 N년 이내**」인데, **N 이 사업주체마다 다르다.**
--     그래서 코드에 3 을 박지 않고 데이터로 둔다(CLAUDE.md §0.5 「사업유형은 데이터다」).
--
--   축은 `app.funding_share_rules` 와 **같다** — 공고 > 사업유형 > 공통.
--     그 표가 이미 그 우선순위를 쓰고 있고, 규칙끼리 축이 어긋나면
--     「이 과제에 적용되는 기준」을 한 번에 모을 수 없다.
--
--       적용범위 = 공고      → announcement_id 필수  (그 공고에만)
--       적용범위 = 사업유형  → 사업유형 필수         (국가 R&D 전체 / 지자체·TP 전체)
--       적용범위 = 공통      → 둘 다 null            (기본값)
--
--   왜 새 표인가
--     `app.projects` 는 **`supabase_admin` 소유라 컬럼을 못 붙인다**(db/104 연구책임자와 같은 사정).
--     과제마다 값이 다른 것도 아니다 — 같은 사업이면 같은 기준이다. 규칙으로 두는 것이 맞다.
--
--   ⚠ 기준연수만 두고 「신규/기존」을 저장하지 않는다.
--     판정 결과는 `personnel_costs.신규채용여부` 에 이미 있고, 그건 **사람이 확정한 값**이다.
--     규칙은 기본값을 만들 뿐이다 — 사람이 끄면 그 판단이 이긴다(설계원칙 1).
--
--   설계 원칙: 추가만. 적용: cd /web/rnd && ./db/psql.sh -f db/112_new_hire_rules.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.new_hire_rules (
  id              bigserial primary key,

  적용범위        text   not null,
  announcement_id bigint references app.announcements(id) on delete cascade,
  사업유형        text   references app.funding_schemes("코드"),

  -- 공고일 기준 **입사 후 이 연수 이내**면 신규채용으로 본다. 0 이면 신규를 만들지 않는다.
  기준연수        integer not null default 3,
  -- 어디서 온 기준인지. 「규정에 없어 사업주체에 확인」 같은 말도 그대로 남긴다.
  근거            text,
  -- 사람이 넣었는가(확정) / 기본값인가(제안). 화면이 이걸로 「확인 필요」를 가른다.
  상태            text   not null default '제안',

  수정자          text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint new_hire_rules_적용범위_chk
    check (적용범위 in ('공고', '사업유형', '공통')),
  constraint new_hire_rules_범위키_chk check (
    (적용범위 = '공고'     and announcement_id is not null and 사업유형 is null) or
    (적용범위 = '사업유형' and announcement_id is null     and 사업유형 is not null) or
    (적용범위 = '공통'     and announcement_id is null     and 사업유형 is null)
  ),
  constraint new_hire_rules_기준연수_chk check (기준연수 >= 0 and 기준연수 <= 20)
);

-- 같은 범위에 규칙이 둘이면 어느 것이 이기는지 알 수 없다. 범위별로 하나만 둔다.
create unique index if not exists new_hire_rules_공통_uniq
  on app.new_hire_rules ((true)) where 적용범위 = '공통';
create unique index if not exists new_hire_rules_사업유형_uniq
  on app.new_hire_rules (사업유형) where 적용범위 = '사업유형';
create unique index if not exists new_hire_rules_공고_uniq
  on app.new_hire_rules (announcement_id) where 적용범위 = '공고';

comment on table app.new_hire_rules is
  '신규채용 판정 기준(공고일 기준 입사 N년 이내). 축은 funding_share_rules 와 같다 — 공고 > 사업유형 > 공통. '
  '사업주체마다 기준이 달라 코드에 박지 않는다. 판정 결과가 아니라 기본값만 만든다.';
comment on column app.new_hire_rules.상태 is
  '제안 = 우리가 둔 기본값 / 확정 = 사람이 공고·규정을 보고 넣은 값. 화면이 이걸로 「확인 필요」를 가른다.';

grant select on app.new_hire_rules to authenticated;
grant all    on app.new_hire_rules to service_role;
grant all    on sequence app.new_hire_rules_id_seq to service_role;

alter table app.new_hire_rules enable row level security;
drop policy if exists authenticated_read_new_hire_rules on app.new_hire_rules;
create policy authenticated_read_new_hire_rules
  on app.new_hire_rules for select to authenticated using (true);

-- 기본값 한 줄. **3년은 우리가 정한 값이 아니라 흔한 값이다** — 그래서 상태를 「제안」으로 둔다.
-- 사업주체 공고문을 확인해 고치면 그때 「확정」이 된다.
insert into app.new_hire_rules (적용범위, 기준연수, 근거, 상태)
select '공통', 3, '기본값 — 공고일 기준 입사 3년 이내를 신규채용으로 보는 관행. 사업주체 공고문으로 확인해야 한다', '제안'
 where not exists (select 1 from app.new_hire_rules where 적용범위 = '공통');

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_new_hire_rules on app.new_hire_rules;
-- drop table if exists app.new_hire_rules;
-- commit;
-- notify pgrst, 'reload schema';
