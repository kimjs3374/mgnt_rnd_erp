-- =============================================================================
-- 96_expense_evidence.sql — 집행 건 단위 증빙 요건 표시
--
--   왜: 증빙은 **집행 한 건**에 붙는다. 「연구재료비」 비목에 견적서 12장이 뒤섞여 있으면
--       어느 건의 견적서인지 알 수 없고, RCMS 는 건별로 묶어 제출한다.
--       실제 폴더도 `01. 연구재료비\(주)천보\2024.06.21\` 처럼 **거래처·날짜(=집행 건)** 아래에
--       1~7 번 파일이 있었다. 그 단위를 화면에 그대로 만든다.
--
--   `app.project_evidence_files.집행_id` 는 95_ 에서 이미 만들어 뒀다. 여기서는
--   **어느 요건을 집행 상세에서 받을지**만 표시한다(`집행단위`).
--
--   사용자 지시(2026-09-03): 재료비 집행에는 **견적서 · 지출결의서 · 거래명세서 · 검수조서** 네 개.
--   발주서·견적의뢰서·세금계산서는 요건 목록에는 남지만 집행 상세에서는 받지 않는다
--   (세금계산서는 결제수단별로 갈려서 `app.evidence_rules` 가 따로 본다).
--   연구활동비도 같은 네 개를 켠다 — 물품·용역 집행이라 서류가 같다.
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/96_expense_evidence.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

alter table app.evidence_requirements
  add column if not exists 집행단위 boolean not null default false;

comment on column app.evidence_requirements.집행단위 is
  'true = 집행 건 상세에서 첨부받는 서류. false = 비목 단위(계상 탭)에서만 관리한다.';

update app.evidence_requirements
   set 집행단위 = true
 where 비목_대분류 in ('FACILITY', 'ACTIVITY')
   and 구분 = '물품·용역'
   and 서류명 in ('견적서', '지출결의서', '거래명세서', '검수조서');

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- alter table app.evidence_requirements drop column if exists 집행단위;
-- commit;
-- notify pgrst, 'reload schema';
