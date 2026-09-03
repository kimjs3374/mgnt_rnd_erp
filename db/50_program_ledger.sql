-- =============================================================================
-- 50_program_ledger.sql — 지원사업 대장 (초안 · 미적용)
--
--   2026-09-03 작성. 스키마는 4명 사이의 계약서이므로 김정수 승인 전에는 적용하지 않는다.
--   적용:  docker exec -i rnd-db psql -U postgres -d postgres < 50_program_ledger.sql
--   되돌리기: 파일 맨 아래 ROLLBACK 블록 참조
--
-- 설계 원칙
--   ① 기존 테이블의 이름과 FK를 바꾸지 않는다.
--      expenses.과제_id · budgets.과제_id · rejections.과제_id 와 뷰 5개가 projects 를
--      참조한다. 이름을 programs 로 바꾸면 네 명의 작업이 동시에 깨진다.
--      → projects 를 "지원사업 한 건"으로 **확장**하고, 화면·용어에서만 「지원사업」으로 부른다.
--   ② 사업유형을 데이터로 둔다. 비목·정산절차를 코드에 박지 않는다.
--   ③ 케이오시 관리대장 컬럼을 그대로 담는다 — 그게 우리가 대체할 대상이다.
--   ④ 추가만 한다. DROP 도 ALTER TYPE 도 없다. 기존 4건 데이터는 그대로 산다.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 사업유형 — 비목 체계와 정산 절차가 여기서 갈린다
-- -----------------------------------------------------------------------------
create table if not exists app.funding_schemes (
  코드            text primary key,          -- LOCAL_TP | NATIONAL_RND | ...
  이름            text not null,
  발주층위        text not null,             -- 지자체 | TP | 중앙부처
  비목체계        text not null,             -- '중기부' | '지자체' | '없음'
  정산시스템      text,                      -- 'RCMS' | null(선집행 후 증빙제출)
  정산방식        text not null,             -- 'PRE_APPROVAL' | 'POST_EVIDENCE'
  협약있음        boolean not null default true,
  중간보고있음    boolean not null default false,
  결과평가있음    boolean not null default false,
  기본_간접비율   numeric,                   -- 없으면 null. 지어내지 않는다
  비고            text
);

comment on table app.funding_schemes is
  '사업유형. 자격요건·제출서류·비목·정산절차가 사업마다 다르므로 코드에 박지 않고 여기에 매단다.';
comment on column app.funding_schemes.정산방식 is
  'PRE_APPROVAL = 협약 후 RCMS 등에 계상·집행·정산(국가R&D). POST_EVIDENCE = 선집행 후 세금계산서·이체증 제출(지자체·TP)';

insert into app.funding_schemes
  (코드, 이름, 발주층위, 비목체계, 정산시스템, 정산방식, 협약있음, 중간보고있음, 결과평가있음, 기본_간접비율, 비고)
values
  ('NATIONAL_RND', '국가 R&D',        '중앙부처', '중기부', 'RCMS', 'PRE_APPROVAL', true,  true,  true,  10,
   '중기부 5직접비+간접비. 협약·연차보고·RCMS 정산. 1.37억/2년 규모'),
  ('LOCAL_TP',     '지자체·TP 지원사업', 'TP',      '지자체', null,   'POST_EVIDENCE', true,  false, true,  null,
   '400만~2400만원. 선집행 후 세금계산서·이체증 제출. 비목이 사업마다 다르다')
on conflict (코드) do nothing;

-- -----------------------------------------------------------------------------
-- 2. 비목을 사업유형별로 가른다
--    기존 categories/sub_categories 는 전부 중기부 체계다. 기본값으로 채워 보존한다.
-- -----------------------------------------------------------------------------
alter table app.categories     add column if not exists 체계 text not null default '중기부';
alter table app.sub_categories add column if not exists 체계 text not null default '중기부';

-- 지자체 사업은 비목이 사업마다 다르므로 마스터를 미리 채우지 않는다.
-- 공고문에서 뽑아 announcement 단위로 붙이거나, 없으면 '미분류'로 둔다.
insert into app.categories (코드, 이름, 직접비, 정렬, 체계) values
  ('LOCAL_UNCAT', '미분류(지자체)', true, 900, '지자체')
on conflict (코드) do nothing;

-- -----------------------------------------------------------------------------
-- 3. projects 확장 — 「지원사업 대장」의 한 행
--    케이오시 관리대장 컬럼: 사업명·기관·공고일·마감일·지원금액/사용금액·
--                            신청접수및결과(발표/심사·결과)·협약기간·중간보고·완료보고·결과평가·비고
-- -----------------------------------------------------------------------------
alter table app.projects
  add column if not exists 사업유형     text        references app.funding_schemes(코드),
  add column if not exists 공고_id      bigint      references app.announcements(id),

  -- 신청 전 ──────────────────────────────────────────────
  add column if not exists 공고일       date,
  add column if not exists 마감일       date,
  add column if not exists 지원금액     bigint,     -- 공고가 말하는 지원 규모
  add column if not exists 신청일       date,

  -- 심사 ────────────────────────────────────────────────
  add column if not exists 발표심사일   date,
  add column if not exists 선정결과     text,       -- 선정 | 탈락 | 대기 | 미신청
  add column if not exists 선정결과일   date,

  -- 수행 후 ─────────────────────────────────────────────
  add column if not exists 중간보고_예정 date,
  add column if not exists 중간보고_완료 date,
  add column if not exists 완료보고_예정 date,
  add column if not exists 완료보고_완료 date,
  add column if not exists 결과평가      text,      -- 원문 그대로. 등급이 사업마다 다르다
  add column if not exists 결과평가일    date,

  add column if not exists 비고          text,
  add column if not exists 출처_행       int;       -- 관리대장 몇 번째 행에서 왔는지(임포트 추적)

comment on column app.projects.선정결과 is '선정 | 탈락 | 대기 | 미신청. 관리대장 「신청접수 및 결과」 열';
comment on column app.projects.결과평가 is '사업마다 등급 체계가 다르므로 원문을 그대로 담는다. 정규화하지 않는다';
comment on column app.projects.비고     is '⚠ 담당자 실명·내부 협의 내용이 들어올 수 있다. 화면 노출 시 마스킹 필요';

-- 지원사업 전 생애주기를 담도록 상태를 넓힌다.
-- 기존 값(수행중 등)은 그대로 두고 CHECK 를 걸지 않는다 — 데이터를 깨지 않기 위해.
comment on column app.projects.상태 is
  '검토 → 신청 → 심사 → 선정|탈락 → 협약 → 수행 → 보고 → 종료. 기존 값과 혼재 가능';

-- 기존 4건은 국가R&D다.
update app.projects set 사업유형 = 'NATIONAL_RND' where 사업유형 is null;

create index if not exists idx_projects_마감일   on app.projects (마감일)   where 마감일 is not null;
create index if not exists idx_projects_사업유형 on app.projects (사업유형);
create index if not exists idx_projects_공고     on app.projects (공고_id);

-- -----------------------------------------------------------------------------
-- 4. 신청 서류 대조 — 「제출 전 점검」이 읽는 곳
--    공고가 요구한 서류(ann_required_docs) × 우리 서류함(documents) 의 대조 결과를
--    사업 단위로 고정해 둔다. 판단 이력이므로 재계산하지 않고 남긴다.
-- -----------------------------------------------------------------------------
create table if not exists app.program_documents (
  id            bigserial primary key,
  과제_id       bigint not null references app.projects(id) on delete cascade,
  서류명        text   not null,
  doc_type      text   references app.doc_types(코드),
  필수여부      boolean not null default true,
  상태          text   not null,             -- 확보 | 미확보 | 만료 | 해당없음 | 확인필요
  document_id   bigint references app.documents(id),
  원문          text,                        -- 공고 원문. 요약 금지
  확인자        text,
  created_at    timestamptz not null default now(),
  unique (과제_id, 서류명)
);

-- -----------------------------------------------------------------------------
-- 5. 제출 전 점검 결과 — 케이오시 현안의 핵심
--    「누락 서류 · 일정 착오 · 문서별 수치 불일치」를 한 곳에 쌓는다.
--    ⚠ 판정 결과가 아니라 **판단 이력**이다. 사람이 확인/무시한 것도 남긴다.
-- -----------------------------------------------------------------------------
create table if not exists app.program_checks (
  id            bigserial primary key,
  과제_id       bigint not null references app.projects(id) on delete cascade,
  종류          text   not null,             -- 서류누락 | 날짜오류 | 금액불일치 | 기한임박 | 요건미충족
  심각도        text   not null,             -- 오류 | 경고 | 정보
  대상          text,                        -- 어느 필드·서류인지
  내용          text   not null,
  근거          text,                        -- 원문 인용. 「AI가 그렇대요」가 되지 않게
  ai_확신도     numeric(4,3),
  처리          text   not null default '미처리',  -- 미처리 | 수정함 | 무시함 | 해당없음
  처리사유      text,                        -- ⚠ 「무시함」이면 필수 (아래 제약)
  처리자        text,
  처리일시      timestamptz,
  created_at    timestamptz not null default now(),

  -- 정정 사유를 강제하는 것과 같은 원리. 무시한 이유가 안 남으면 다음 사람이 또 판단한다.
  constraint chk_program_checks_사유
    check (처리 <> '무시함' or (처리사유 is not null and length(btrim(처리사유)) > 0))
);

create index if not exists idx_program_checks_과제 on app.program_checks (과제_id, 처리);

comment on table app.program_checks is
  '제출 전 점검. 케이오시 관리대장에서 실제로 발견된 것 — 마감일 2026.11.31(없는 날짜), '
  '지원금액 칸에 14, 월2400만원/100만원(단위 혼재), 사업명만 있고 전부 공란. 시연 소재다.';

-- -----------------------------------------------------------------------------
-- 6. 지원사업 대장 뷰 — 케이오시 관리대장을 그대로 재현한다
--    화면은 이 뷰 하나만 읽는다.
-- -----------------------------------------------------------------------------
create or replace view app.v_program_ledger as
select
  p.id,
  p.과제명                                   as 사업명,
  coalesce(p.전문기관, p.부처)               as 기관,
  fs.이름                                    as 사업유형,
  p.공고일,
  p.마감일,
  case when p.마감일 is not null
       then (p.마감일 - current_date) end    as d_day,
  p.지원금액,
  coalesce(x.집행액, 0)::bigint              as 사용금액,
  case when coalesce(p.지원금액,0) > 0
       then round(coalesce(x.집행액,0) * 100.0 / p.지원금액, 1) end as 집행률,
  p.신청일,
  p.발표심사일,
  p.선정결과,
  p.시작일                                   as 협약시작,
  p.종료일                                   as 협약종료,
  p.중간보고_완료,
  p.완료보고_완료,
  p.결과평가,
  p.상태,
  coalesce(c.미처리점검, 0)                  as 미처리점검,
  coalesce(d.미확보서류, 0)                  as 미확보서류,
  p.비고                                     -- ⚠ 화면에서 마스킹할 것
from app.projects p
left join app.funding_schemes fs on fs.코드 = p.사업유형
left join lateral (
  select sum(e.합계) as 집행액
  from app.expenses e
  where e.과제_id = p.id and e.상태 in ('확정','제출','정산완료')
) x on true
left join lateral (
  select count(*) as 미처리점검
  from app.program_checks pc
  where pc.과제_id = p.id and pc.처리 = '미처리' and pc.심각도 <> '정보'
) c on true
left join lateral (
  select count(*) as 미확보서류
  from app.program_documents pd
  where pd.과제_id = p.id and pd.필수여부 and pd.상태 in ('미확보','만료')
) d on true;

comment on view app.v_program_ledger is
  '지원사업 대장. 케이오시 「정부과제 Master 관리대장」의 열 구성을 그대로 재현한다. '
  '대장 화면은 이 뷰 하나만 읽는다.';

-- -----------------------------------------------------------------------------
-- 7. 자격 판정 이력 — 판정 엔진의 두 번째 용도
--    비목 판정(decisions)과 같은 모양이다. AI 제안 → 사람 확정 → 정정 사유.
-- -----------------------------------------------------------------------------
create table if not exists app.eligibility_decisions (
  id              bigserial primary key,
  announcement_id bigint not null references app.announcements(id) on delete cascade,
  과제_id         bigint references app.projects(id),
  ai_제안         jsonb  not null,            -- 요건별 판정 + 근거 + 확신도
  ai_확신도       numeric(4,3),
  확정_판정       text   not null,            -- 가능 | 불가 | 확인필요 | 요건미확인
  정정여부        boolean not null default false,
  정정사유_유형   text,                       -- 관행 | 해석 | 사업특수 | 판독오류
  정정사유        text,
  확정자          text,
  created_at      timestamptz not null default now(),

  -- decisions 와 같은 제약. 왜 고쳤는지가 안 남으면 쌓아도 좋아지지 않는다.
  constraint chk_elig_정정사유
    check (not 정정여부 or (정정사유 is not null and 정정사유_유형 is not null))
);

create index if not exists idx_elig_공고 on app.eligibility_decisions (announcement_id);

comment on table app.eligibility_decisions is
  '자격 판정 이력. decisions(비목 판정)와 같은 구조 — 같은 판정 엔진의 두 번째 용도다. '
  '「요건미확인」은 「확인필요」보다 아래 등급이다: 접수기간만 보면 1,479건 중 729건이 '
  '「신청 가능」으로 잘못 찍힌다.';

commit;

-- =============================================================================
-- 되돌리기 — 문제가 생기면 이것만 돌린다. 기존 데이터는 손대지 않는다.
-- =============================================================================
-- begin;
-- drop view  if exists app.v_program_ledger;
-- drop table if exists app.eligibility_decisions;
-- drop table if exists app.program_checks;
-- drop table if exists app.program_documents;
-- alter table app.projects
--   drop column if exists 사업유형,     drop column if exists 공고_id,
--   drop column if exists 공고일,       drop column if exists 마감일,
--   drop column if exists 지원금액,     drop column if exists 신청일,
--   drop column if exists 발표심사일,   drop column if exists 선정결과,
--   drop column if exists 선정결과일,   drop column if exists 중간보고_예정,
--   drop column if exists 중간보고_완료, drop column if exists 완료보고_예정,
--   drop column if exists 완료보고_완료, drop column if exists 결과평가,
--   drop column if exists 결과평가일,   drop column if exists 비고,
--   drop column if exists 출처_행;
-- alter table app.categories     drop column if exists 체계;
-- alter table app.sub_categories drop column if exists 체계;
-- delete from app.categories where 코드 = 'LOCAL_UNCAT';
-- drop table if exists app.funding_schemes;
-- commit;
