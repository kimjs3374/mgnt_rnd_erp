-- =============================================================================
-- 92_company_profile_magnatech.sql — 회사 프로필을 매그나텍 실제 값으로 세운다
--
--   2026-09-03 작성·적용.
--
-- 왜 필요한가
--   ① 공고 탐색의 지역·지원대상 필터가 대조할 **우리 쪽 값이 없었다.**
--      company_profile 에 회사명도, 소재지도, 기업규모도 컬럼 자체가 없다.
--      대조 기준이 없으니 판정이 전부 「확인 필요」로 남는다.
--   ② 들어 있던 재무값(매출 74억 · 종업원 42명 등)은 합성값이다(2026-09-03 대표자 확인).
--      합성값으로 자격을 판정하면 틀린 답을 근거까지 붙여서 내놓는다. 가장 나쁜 실패다.
--
-- 무엇을 넣고 무엇을 비우는가 — CLAUDE.md §6 「수치를 지어내지 않는다」
--   넣는다(근거가 있는 것):
--     회사명·대표자   팀정보.md
--     지역 전남광주   팀정보.md — 전원 전남광주 소재 매그나텍 재직, 트랙판정.md 재직 예외 충족
--     기업규모 중소기업 트랙판정.md — 「전남광주 소재 중소기업 재직 + 증빙」으로 충족 처리됨
--     기업부설연구소   02.회사데이터 지출결의서 적요 「연구소 소재 구매」 + RS-2023-00227285 수행
--     업종             02.회사데이터 증빙 — 배터리사업부 · Celgard Separator for lithium ion
--                      battery research · 에스비티엘첨단소재 · 금호석유화학 거래.
--                      이차전지 소재로 확정된다. KSIC 코드 자체는 사업자등록증을 못 봐서 비운다.
--   비운다(확인 못 한 것):
--     매출액 · 매출증가율 · 부채비율 · R&D 집약도 · 종업원수 · KSIC 코드 · 사업자등록번호
--     → 화면(회사 프로필)에서 사람이 직접 넣는다. 비어 있으면 판정이 「확인 필요」로 남는다.
--        추측으로 채우면 지원 자격이 없는 공고에 계획서를 쓰게 된다.
--
-- 설계 원칙
--   ① 추가만 한다. 기존 컬럼을 DROP 하지 않는다 — 합성 재무값은 null 로 비우되 컬럼은 산다.
--   ② 지역은 배열이다. announcements.지역코드 와 같은 라벨을 쓴다(app.지역정규화).
--      라벨이 갈라지면 대조가 조용히 전부 실패한다.
--   ③ 지원대상_유형도 배열이다. 기업마당 trgetNm(중소기업·소상공인·창업벤처…)과 직접 대조한다.
--
-- 적용:    sudo docker exec -i rnd-db psql -U postgres -d postgres < db/92_company_profile_magnatech.sql
--          (app 스키마 소유자가 supabase_admin 이라 rnd_dev 로는 ALTER 가 안 된다)
-- 되돌리기: 파일 맨 아래 ROLLBACK 블록
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 신원·소재지 컬럼 — 자격 대조가 실제로 쓰는 값들
-- -----------------------------------------------------------------------------
alter table app.company_profile
  add column if not exists 회사명          text,
  add column if not exists 사업자등록번호  text,
  add column if not exists 대표자          text,
  add column if not exists 소재지          text,
  add column if not exists 지역코드        text[],
  add column if not exists 기업규모        text,
  add column if not exists 업종명          text[],
  add column if not exists 주요제품        text,
  add column if not exists 설립일          date,
  add column if not exists 지원대상_유형   text[];

comment on column app.company_profile.지역코드 is
  'announcements.지역코드 와 같은 라벨(app.지역정규화). 공고의 지역코드와 교집합이 있으면 지역 요건을 충족한다. '
  '「전국」 공고는 어느 회사든 통과한다.';
comment on column app.company_profile.지원대상_유형 is
  '기업마당 trgetNm 과 직접 대조하는 값. 중소기업 · 소상공인 · 창업벤처 · 사회적기업 · 장애인기업 · 마을기업 · 여성기업.';
comment on column app.company_profile.사업자등록번호 is
  '자사 사업자번호. **증빙 판독의 거래 방향 확정에 쓰는 값과 같은 것**이어야 한다(봇은 OUR_BRN 환경변수로 읽는다). '
  '둘이 다르면 공급자/공급받는자가 뒤집힌다. 비어 있으면 판정을 「보류」로 둔다.';
comment on column app.company_profile.업종명 is
  '사람이 읽는 업종. KSIC 코드(ksic_코드)와 별개다 — 코드는 사업자등록증에서 확인한 뒤에만 채운다.';

-- -----------------------------------------------------------------------------
-- 2. 매그나텍 — 근거가 있는 값만 넣는다
-- -----------------------------------------------------------------------------
update app.company_profile
   set 회사명        = '(주)매그나텍',
       대표자        = '김정수',
       소재지        = '전남광주 광산구',
       지역코드      = array['전남광주'],
       기업규모      = '중소기업',
       업종명        = array['이차전지 소재', '전지 부품·소재 제조'],
       주요제품      = '리튬이온전지용 분리막·소재 (Celgard Separator 등 연구개발용 소재 조달·평가)',
       지원대상_유형 = array['중소기업'],
       기업부설연구소 = true,
       출처_문서     = '팀정보.md(소재지·대표자) · 02.회사데이터 증빙(업종·연구소) · 트랙판정.md(기업규모)',
       updated_at    = now()
 where id = 1;

-- -----------------------------------------------------------------------------
-- 3. 합성 재무값을 비운다 — 지어낸 숫자로 자격을 판정하지 않는다
--    컬럼은 그대로 두고 값만 null 로 만든다. 회사 프로필 화면에서 사람이 채운다.
-- -----------------------------------------------------------------------------
update app.company_profile
   set 매출액       = null,
       매출증가율   = null,
       부채비율     = null,
       rnd_집약도   = null,
       종업원수     = null,
       ksic_코드    = null,
       자본전액잠식 = false   -- 「해당 없음」은 확인된 사실이다(자본잠식이면 과제 수행 자체가 불가)
 where id = 1;

commit;

-- 결과 확인
--   select 회사명, 소재지, 지역코드, 기업규모, 지원대상_유형, 매출액, 종업원수 from app.company_profile;

-- =============================================================================
-- ROLLBACK — 되돌릴 때만. 재무값은 합성값이라 되살리지 않는다.
-- =============================================================================
-- begin;
-- alter table app.company_profile
--   drop column if exists 회사명,
--   drop column if exists 사업자등록번호,
--   drop column if exists 대표자,
--   drop column if exists 소재지,
--   drop column if exists 지역코드,
--   drop column if exists 기업규모,
--   drop column if exists 업종명,
--   drop column if exists 주요제품,
--   drop column if exists 설립일,
--   drop column if exists 지원대상_유형;
-- commit;
