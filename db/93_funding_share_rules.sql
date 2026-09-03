-- =============================================================================
-- 93_funding_share_rules.sql — 재원 분담 규칙(정부출연금 · 민간부담금)
--
--   왜 테이블로 두는가
--     연구비 계상에서 정부출연금과 민간부담금을 손으로 넣으면, 그 숫자가 어디서 나왔는지
--     아무 데도 남지 않는다. 이 제품의 주장은 「결과가 아니라 근거를 쌓는다」이므로
--     비율을 코드에 박지 않고 **원문·출처와 함께 데이터로** 둔다(CLAUDE.md §0.5 「사업유형은
--     데이터다. 코드에 박지 않는다」 · 설계원칙 1).
--
--   왜 비율을 상수로 안 쓰는가 — 문서끼리 어긋나 있다
--     CLAUDE.md §11: 정부지원 비율이 「기준선 134/137 = 97.8%」 대 「중소기업 75% 이내」로
--     충돌하고 결론은 **「추정치다. 확인 필요」**다. 실제로 둘 다 맞다 —
--     75% 는 2026 지역혁신선도기업육성 공고의 유의사항이고, 97.8% 는 매그나텍이 수행한
--     중기부 산학연 과제의 실측이다. **사업(공고)마다 다르다.**
--     그래서 규칙에 `announcement_id` 를 두고 **공고 행이 규정 행을 이기게** 한다.
--
--   상태 3값의 뜻 — 틀린 「통과」가 틀린 「위반」보다 나쁘다
--     확정   공고문 원문에서 확인했다 → 자동 입력해도 된다
--     제안   팀 문서 표에서 왔고 공고 원문 대조 전이다 → 값은 보여주되 사람이 확정한다
--     미확인 근거가 약하다 → 자동 확정 금지(설계원칙 3, 확신도 0.70 미만과 같은 취급)
--
--   설계 원칙: 추가만 한다. 기존 컬럼·테이블을 지우거나 이름 바꾸지 않는다(CLAUDE.md §3.5).
--   적용:     cd /web/rnd && ./db/psql.sh -f db/93_funding_share_rules.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

create table if not exists app.funding_share_rules (
  id              bigserial primary key,
  -- 중소기업 | 중견기업 | 대기업 | 비영리 | 대학 | 출연연  (company_profile.기업규모 와 같은 어휘)
  기관유형        text    not null,
  -- null = 사업유형 무관 기본 규정. 값이 있으면 그 유형에만 적용된다.
  사업유형        text    references app.funding_schemes(코드),
  -- null = 규정. 값이 있으면 그 공고 전용이고 **규정보다 우선한다.**
  announcement_id bigint  references app.announcements(id) on delete cascade,

  정부출연_상한   numeric not null,             -- 총사업비 대비 %
  민간현금_최소   numeric,                      -- 민간부담금 대비 %
  민간현물_최대   numeric,                      -- 민간부담금 대비 %
  간접비_상한     numeric,                      -- 직접비 대비 %. 총액 역산은 lib/verify.ts 가 한다
  -- 절사 자릿수(10^n). 3 = 천원 단위. 공고마다 다르면 행마다 다르게 둘 수 있다.
  절사단위        integer not null default 3,

  원문            text    not null,             -- 공고·규정에서 그대로 인용. 지어낸 규칙인지 검증하는 유일한 근거
  출처            text    not null,             -- 어느 문서 몇 쪽인지
  상태            text    not null default '제안',
  confidence      numeric(4,3),
  created_at      timestamptz not null default now(),

  constraint funding_share_rules_상태_chk check (상태 in ('확정','제안','미확인')),
  constraint funding_share_rules_정부출연_chk check (정부출연_상한 >= 0 and 정부출연_상한 <= 100)
);

-- 같은 (기관유형, 사업유형, 공고) 조합이 두 벌 생기면 어느 쪽을 쓸지 코드가 정하게 된다.
-- 그 판단을 코드에 두지 않으려고 DB 에서 막는다.
create unique index if not exists funding_share_rules_uniq
  on app.funding_share_rules (기관유형, coalesce(사업유형,''), coalesce(announcement_id, 0));

comment on table app.funding_share_rules is
  '정부출연금·민간부담금 분담 규칙. 공고 행(announcement_id 있음) > 사업유형 행 > 기본 행 순으로 이긴다. '
  '⚠ 정부지원 비율은 사업마다 다르다 — 2026 지역혁신선도기업육성 공고는 중소기업 75% 이내인데 '
  '매그나텍 수행 과제(RS-2023-00227285)는 134/137 = 97.8% 였다. 그래서 상수로 박지 않는다.';
comment on column app.funding_share_rules.원문 is
  '공고·규정에서 그대로 인용한다. 화면에 이 문장을 띄우고 판정 근거로 쓴다.';
comment on column app.funding_share_rules.상태 is
  '확정=공고 원문 확인, 자동 입력 허용 · 제안=팀 문서 표 근거, 사람이 확정 · 미확인=자동 확정 금지.';

grant select on app.funding_share_rules to authenticated;
grant all    on app.funding_share_rules to service_role;
grant all    on sequence app.funding_share_rules_id_seq to service_role;

alter table app.funding_share_rules enable row level security;
drop policy if exists authenticated_read_funding_share_rules on app.funding_share_rules;
create policy authenticated_read_funding_share_rules
  on app.funding_share_rules for select to authenticated using (true);

-- ── 규정 기본값 ──────────────────────────────────────────────────────────────
-- 중소기업 행만 「확정」이다. 공고문 원문에서 나왔다.
--   출처: 파일분석_결과.md §1.8 「확정된 한도 규정(2026 지역혁신선도기업육성 공고 유의사항 원문)」
--        — HWP 43건을 rhwp v0.8.4 로 전수 파싱해 확인한 값이다.
-- 나머지 5행은 팀 문서의 기관유형 표에서 왔고 공고 원문 대조 전이라 「제안」으로 둔다.
insert into app.funding_share_rules
  (기관유형, 사업유형, announcement_id, 정부출연_상한, 민간현금_최소, 민간현물_최대, 간접비_상한, 원문, 출처, 상태, confidence)
values
  ('중소기업', null, null, 75,  10,  90, 10,
   '정부지원 연구개발비는 중소기업 75% 이내(기관부담 25% 이상). 기업부담금 중 현금 10% 이상 · 현물 90% 이하.',
   '2026 지역혁신선도기업육성 공고 유의사항(HWP 원문) · 파일분석_결과.md §1.8', '확정', 1.000),
  ('중견기업', null, null, 70,  10,  90, 10,
   '기관 유형별 계상 규칙 — 중견기업 정부출연 상한 70% · 민간현금 최소 10% · 현물 최대 90% · 간접비 10%.',
   '통합기능목록.md B.6 기관 유형별 계상 규칙 6종', '제안', null),
  ('대기업',   null, null, 50,  10,  90, 10,
   '기관 유형별 계상 규칙 — 대기업 정부출연 상한 50% · 민간현금 최소 10% · 현물 최대 90% · 간접비 10%.',
   '통합기능목록.md B.6 기관 유형별 계상 규칙 6종', '제안', null),
  ('비영리',   null, null, 100,  0, 100, 10,
   '기관 유형별 계상 규칙 — 비영리 정부출연 100% · 민간부담 없음 · 간접비 10%.',
   '통합기능목록.md B.6 기관 유형별 계상 규칙 6종', '제안', null),
  ('대학',     null, null, 100,  0, 100, 17,
   '기관 유형별 계상 규칙 — 대학 정부출연 100% · 민간부담 없음 · 간접비 17%.',
   '통합기능목록.md B.6 기관 유형별 계상 규칙 6종', '제안', null),
  ('출연연',   null, null, 100,  0, 100, 17,
   '기관 유형별 계상 규칙 — 출연연 정부출연 100% · 민간부담 없음 · 간접비 17%.',
   '통합기능목록.md B.6 기관 유형별 계상 규칙 6종', '제안', null)
on conflict do nothing;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_funding_share_rules on app.funding_share_rules;
-- drop table if exists app.funding_share_rules;
-- commit;
-- notify pgrst, 'reload schema';
