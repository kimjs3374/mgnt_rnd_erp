-- =============================================================================
-- 91_bizinfo_facets.sql — 기업마당 공고의 지역·지원분야·지원대상을 데이터로 세운다
--
--   2026-09-03 작성·적용. 지원사업 > 공고 탐색(/announcements) 전용.
--
-- 왜 필요한가
--   화면에 지역 필터가 있는데 값이 없었다 — announcements 332건 중 지역이 채워진 건 2건.
--   수집기가 "기업마당 레코드에 지역 필드가 없다"고 판단하고 null 로 넣어 왔기 때문이다.
--
--   그런데 실제 API 응답에는 지역이 두 군데 들어 있다(2026-09-03 실측, 300건):
--     ① pblancNm 앞머리의 대괄호 태그 — [전남광주] 40건 · [경기] 23건 … 217건
--     ② jrsdInsttNm — 전남광주통합특별시 43 · 경상북도 26 · 경기도 25 …
--   ①이 없고 ②가 중앙부처(중소벤처기업부·산업통상부 등)면 지역 제한이 없는 공고다 → 「전국」.
--   지어내는 것이 아니라 **적혀 있는 것을 읽는 것**이다.
--
--   같이 버려지고 있던 필드도 세운다. 전부 API 가 이미 주는 값이다:
--     pldirSportRealmLclasCodeNm → 지원분야 (경영 91 · 기술 90 · 수출 43 · 내수 26 …)
--     trgetNm                    → 지원대상 (중소기업 241 · 소상공인 25 · 창업벤처 19 …)
--     pblancUrl                  → 공고url  (기업마당 원문 상세페이지)
--     bsnsSumryCn                → 요약     (HTML 제거)
--     refrncNm                   → 문의처   (부서·전화. 개인 실명이 섞이면 수집기가 거른다)
--     creatPnttm                 → 공고일   (게시일. created_at=우리가 수집한 시각과 다른 것)
--
-- 설계 원칙
--   ① 추가만 한다. DROP 도 ALTER TYPE 도 롤 DDL 도 없다. 기존 332건은 그대로 산다.
--   ② 지역은 배열이다. [대구ㆍ경북] 처럼 둘을 함께 거는 공고가 실제로 있다.
--      단일 text 로 두면 「대구」 필터에서 그 공고가 조용히 사라진다.
--   ③ 정규화 규칙을 SQL 함수로 둔다. 수집기(JS)와 백필(SQL)이 같은 표를 봐야
--      나중에 수집한 행과 지금 있는 행의 지역 라벨이 갈라지지 않는다.
--   ④ 모르면 비운다. 태그도 없고 소관부처도 시도명이 아니고 중앙부처도 아니면 null 이다.
--      「전국」으로 밀어 넣으면 지역 제한이 있는 공고를 전국 공고로 둔갑시킨다.
--
-- 적용:    db/apply.sh 또는 db/psql.sh -f db/91_bizinfo_facets.sql
-- 되돌리기: 파일 맨 아래 ROLLBACK 블록
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 컬럼 추가 — 전부 기업마당 API 가 이미 주는 값이다
-- -----------------------------------------------------------------------------
alter table app.announcements
  add column if not exists 지역코드   text[],
  add column if not exists 지원분야   text,
  add column if not exists 지원대상   text,
  add column if not exists 공고url    text,
  add column if not exists 요약       text,
  add column if not exists 문의처     text;

comment on column app.announcements.지역코드 is
  '시도 단위 정규화 라벨의 배열. {전국} 은 지역 제한이 없다는 뜻이고, null 은 모른다는 뜻이다 — 둘은 다르다. '
  '[대구ㆍ경북] 처럼 둘을 함께 거는 공고가 있어 배열로 둔다.';
comment on column app.announcements.지원분야 is
  '기업마당 pldirSportRealmLclasCodeNm. 경영·기술·수출·내수·인력·창업·금융·기타 8종.';
comment on column app.announcements.지원대상 is
  '기업마당 trgetNm. 중소기업·소상공인·창업벤처·사회적기업·장애인기업·마을기업·여성기업.';
comment on column app.announcements.공고url is
  '기업마당 원문 상세페이지(pblancUrl). 화면이 「원문 보기」로 건다 — 우리 판독을 심사위원이 원문과 대조할 수 있어야 한다.';
comment on column app.announcements.요약 is
  '기업마당 bsnsSumryCn 에서 HTML 을 걷어낸 것. LLM 요약이 아니라 기관이 쓴 원문이다.';
comment on column app.announcements.문의처 is
  '기업마당 refrncNm(부서·전화). 개인 실명으로 보이는 토막은 수집기가 지운다 — CLAUDE.md §2-6 개인정보.';

create index if not exists idx_ann_지역코드 on app.announcements using gin (지역코드);
create index if not exists idx_ann_지원분야 on app.announcements (지원분야);
create index if not exists idx_ann_지원대상 on app.announcements (지원대상);

-- -----------------------------------------------------------------------------
-- 2. 지역 정규화 — 수집기(JS)와 백필(SQL)이 같은 표를 본다
--
--    이 세계관에서 전남과 광주는 「전남광주통합특별시」로 합쳐져 있다(API 실측).
--    그래서 전남·광주·전라남도·광주광역시는 전부 한 라벨 「전남광주」로 모은다 —
--    나누면 매그나텍(전남광주 광산구) 이 자기 지역 공고 40건 중 일부를 못 본다.
-- -----------------------------------------------------------------------------
create or replace function app.지역정규화(원문 text)
returns text
language sql immutable as $$
  select case
    when 원문 is null then null
    when 원문 ~ '전남광주|전라남도|광주광역시|^전남$|^광주$' then '전남광주'
    when 원문 ~ '서울'                        then '서울'
    when 원문 ~ '부산'                        then '부산'
    when 원문 ~ '대구'                        then '대구'
    when 원문 ~ '인천'                        then '인천'
    when 원문 ~ '대전'                        then '대전'
    when 원문 ~ '울산'                        then '울산'
    when 원문 ~ '세종'                        then '세종'
    when 원문 ~ '경기'                        then '경기'
    when 원문 ~ '강원'                        then '강원'
    when 원문 ~ '충청북도|^충북$'              then '충북'
    when 원문 ~ '충청남도|^충남$'              then '충남'
    when 원문 ~ '전북|전라북도'                then '전북'
    when 원문 ~ '경상북도|^경북$'              then '경북'
    when 원문 ~ '경상남도|^경남$'              then '경남'
    when 원문 ~ '제주'                        then '제주'
    when 원문 ~ '^전국$|전 지역'               then '전국'
    else null
  end
$$;

comment on function app.지역정규화(text) is
  '시도명 한 토막 → 정규화 라벨. 못 알아보면 null 이다. 「전국」으로 넘기지 않는다 — '
  '지역 제한이 있는 공고를 전국 공고로 둔갑시키면 신청 자격이 없는 곳에 계획서를 쓴다.';

/**
 * 사업명 앞머리 태그 + 소관부처로 지역 배열을 정한다.
 *   ① [전남광주] · [대구ㆍ경북] 같은 대괄호 태그가 있으면 그것이 우선이다(기관이 직접 붙인 것).
 *   ② 없으면 소관부처가 시도명인지 본다.
 *   ③ 둘 다 아닌데 소관부처가 있으면 중앙부처·공공기관이다 → 전국.
 *   ④ 소관부처조차 없으면 null. 모른다.
 */
create or replace function app.공고지역(사업명 text, 소관부처 text)
returns text[]
language sql immutable as $$
  with 태그 as (
    select array_remove(
      array(
        select app.지역정규화(trim(t))
        from unnest(regexp_split_to_array(
               coalesce(substring(사업명 from '^\s*\[([^\]]+)\]'), ''), '[ㆍ·,/]')) as t
      ), null) as v
  )
  select case
    when (select cardinality(v) from 태그) > 0 then (select v from 태그)
    when app.지역정규화(소관부처) is not null   then array[app.지역정규화(소관부처)]
    when 소관부처 is not null and 소관부처 <> '' then array['전국']
    else null
  end
$$;

comment on function app.공고지역(text, text) is
  '기업마당 공고의 지역 배열. 사업명 대괄호 태그 > 소관부처 시도명 > 중앙부처면 전국 > 모르면 null.';

-- -----------------------------------------------------------------------------
-- 3. 기존 행 백필 — 이미 들어와 있는 기업마당 공고에도 지역을 채운다
--    수집을 다시 돌리지 않아도 화면의 지역 필터가 바로 산다.
-- -----------------------------------------------------------------------------
update app.announcements
   set 지역코드 = app.공고지역(사업명, 소관부처)
 where 출처 = '기업마당'
   and 지역코드 is null;

-- 사람이 직접 넣어 둔 기존 지역 문자열 2건(전남광주통합특별시 · 전국)도 같은 라벨로 세운다.
update app.announcements
   set 지역코드 = array[coalesce(app.지역정규화(지역), '전국')]
 where 지역코드 is null
   and 지역 is not null
   and 지역 <> '';

commit;

-- 결과 확인
--   select unnest(지역코드) as 지역, count(*) from app.announcements
--    where 출처='기업마당' group by 1 order by 2 desc;

-- =============================================================================
-- ROLLBACK — 되돌릴 때만
-- =============================================================================
-- begin;
-- drop index if exists app.idx_ann_지역코드;
-- drop index if exists app.idx_ann_지원분야;
-- drop index if exists app.idx_ann_지원대상;
-- alter table app.announcements
--   drop column if exists 지역코드,
--   drop column if exists 지원분야,
--   drop column if exists 지원대상,
--   drop column if exists 공고url,
--   drop column if exists 요약,
--   drop column if exists 문의처;
-- drop function if exists app.공고지역(text, text);
-- drop function if exists app.지역정규화(text);
-- commit;
