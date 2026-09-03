-- =============================================================================
-- 93_document_shelf.sql — 서류함: 공고가 반복해서 요구하는 서류 + 유효기간
--
--   2026-09-03 작성. 지원사업·과제사업 공고문에서 뽑아 둔 요구서류(app.ann_required_docs)를
--   서류 「종류」로 묶어, 우리가 무엇을 가지고 있어야 하고 그게 아직 유효한지 답한다.
--
-- 왜 필요한가
--   같은 서류를 공고마다 다른 이름으로 부른다(실측):
--     사업자등록증 · 사업자등록증 사본 · 사업자 등록증 · 사업자등록증 사본(사업자등록증명원)
--     법인등기부등본 · 등기사항증명서(말소사항 포함) · 법인등기사항전부증명서
--     국세납세증명서 · 국세완납증명서 · 국세·지방세 완납 증명서 · 국세‧지방세 완납증명서
--   이름으로 세면 「7개 공고가 사업자등록증을 요구」가 안 나온다. 종류로 묶어야 나온다.
--   그게 서류함이 답해야 할 첫 질문이다 — **어차피 계속 낼 서류가 무엇인가.**
--
-- 유효기간 규칙 (2026-09-03 대표자 지정)
--   ① 공공문서는 발급일로부터 **90일**. 발급받아 오는 증명서가 여기 해당한다.
--   ② **사업자등록증은 제외** — 유효기간이 없다(permanent).
--   ③ 공고문에 유효기간이 따로 적혀 있으면 **공고문이 이긴다.**
--      "3개월 이내 발급분" · "발행일로부터 2개월 이내" · "1개월 이내" 처럼 적혀 온다.
--      여러 공고가 서로 다르게 말하면 **가장 짧은 것**을 쓴다 — 그래야 어느 공고에도 낼 수 있다.
--
-- 설계 원칙
--   ① 추가만 한다. 기존 doc_types 8행·documents 5행은 그대로 산다.
--   ② 「필수/참고」를 사람이 정하지 않는다. **공고가 필수로 요구했는지**로 계산한다.
--      한 곳이라도 필수로 요구했으면 필수다. 아무도 필수로 안 부르면 참고다.
--   ③ 못 알아본 서류명은 버리지 않는다. doc_types 에 안 걸리면 null 로 남고
--      화면이 「분류 안 됨」으로 따로 보여준다 — 조용히 사라지면 빠뜨린다.
--   ④ 유효일수를 새로 둔다. 기존 유효개월(정수 개월)로는 90일을 정확히 못 쓴다.
--
-- 적용: sudo docker exec -i rnd-db psql -U postgres -d postgres < db/93_document_shelf.sql
--       (app 스키마 소유자가 supabase_admin 이라 rnd_dev 로는 ALTER 가 막힌다)
-- 되돌리기: 파일 맨 아래 ROLLBACK 블록
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. doc_types 확장
-- -----------------------------------------------------------------------------
alter table app.doc_types
  add column if not exists 유효일수   integer,
  add column if not exists 공공문서   boolean not null default false,
  add column if not exists 별칭       text[],
  add column if not exists 발급처     text,
  add column if not exists 정렬       integer;

comment on column app.doc_types.유효일수 is
  '발급일로부터 며칠간 유효한가. 유효개월(정수 개월)보다 **우선**한다 — 90일을 3개월로 적으면 '
  '달의 길이에 따라 최대 2일이 어긋나는데, 마감 당일에 그 2일이 서류를 못 쓰게 만든다.';
comment on column app.doc_types.공공문서 is
  '관공서에서 발급받아 오는 증명서인가. true 면 기본 유효기간 90일이 걸린다(사업자등록증 제외 — '
  '그건 공공문서지만 유효기간 자체가 없다).';
comment on column app.doc_types.별칭 is
  '공고문이 이 서류를 부르는 이름들(정규식). app.서류종류들() 이 이걸로 매칭한다. '
  '공고마다 이름이 달라서 이름으로 세면 같은 서류가 여러 종류로 흩어진다.';

-- -----------------------------------------------------------------------------
-- 2. 기존 8종의 유효기간을 규칙대로 다시 세운다
--    지금은 국세·지방세가 1개월, 법인등기부등본이 3개월로 제각각이다.
-- -----------------------------------------------------------------------------
update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'permanent', 유효일수 = null,
  발급처 = '세무서 · 홈택스',
  별칭 = array['사업자\s*등록증', '사업자등록증명원'],
  정렬 = 10
 where 코드 = 'BIZ_REG';

update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'days', 유효일수 = 90,
  발급처 = '등기소 · 인터넷등기소',
  별칭 = array['법인\s*등기', '등기\s*사항.*증명', '등기부\s*등본'],
  정렬 = 20
 where 코드 = 'CORP_REG';

update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'days', 유효일수 = 90,
  발급처 = '세무서 · 홈택스',
  별칭 = array['국세.*(납세|완납)', '납세증명.*국세'],
  정렬 = 30
 where 코드 = 'TAX_CLEAR';

update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'days', 유효일수 = 90,
  발급처 = '시·군·구청 · 위택스',
  별칭 = array['지방세.*(납세|완납)'],
  정렬 = 40
 where 코드 = 'LOCAL_TAX';

update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'days', 유효일수 = 90,
  발급처 = '국민연금공단 · 건강보험공단',
  별칭 = array['4대\s*보험', '가입자\s*명부', '사업장\s*가입자'],
  정렬 = 60
 where 코드 = 'EMPLOY';

-- 표준재무제표증명은 결산연도 개념이 맞다. 90일을 걸면 결산 직후 3개월만 유효해진다.
update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'fiscal_year',
  발급처 = '세무서 · 홈택스',
  별칭 = array['표준\s*재무제표', '재무제표\s*증명', '회계감사보고서'],
  정렬 = 50
 where 코드 = 'FIN_STMT';

update app.doc_types set
  공공문서 = false, 유효기간_종류 = 'permanent',
  발급처 = '한국산업기술진흥협회',
  별칭 = array['기업부설연구소', '연구개발전담부서', '연구소\s*인정서'],
  정렬 = 80
 where 코드 = 'RND_CENTER';

update app.doc_types set
  공공문서 = true, 유효기간_종류 = 'per_notice',
  발급처 = '특허청 · 특허로',
  별칭 = array['특허.*등록원부', '실용신안.*등록원부', '지식재산권.*등록원부'],
  정렬 = 90
 where 코드 = 'PATENT';

-- -----------------------------------------------------------------------------
-- 3. 공고가 실제로 요구하는데 서류함에 없던 종류를 추가한다
--    빈도는 app.ann_required_docs 실측 — 중소기업확인서 5건, 공장등록증 2건, 인감증명서 2건.
-- -----------------------------------------------------------------------------
insert into app.doc_types (코드, 이름, 유효기간_종류, 유효일수, 공공문서, 발급처, 별칭, 정렬, 비고)
values
  ('SME_CERT', '중소기업확인서', 'days', 90, true, '중소기업현황정보시스템',
   array['중소기업\s*확인서', '중견기업\s*확인서', '소상공인\s*확인서'], 70,
   '공공문서 기본 90일. 실제 발급 유효기간은 발급 회차에 따라 다르므로 공고가 명시하면 그쪽이 우선한다.'),
  ('FACTORY', '공장등록증', 'permanent', null, true, '시·군·구청 · 팩토리온',
   array['공장\s*등록증', '공장등록\s*증명'], 100,
   '등록 사실 증명이라 유효기간이 없다. 내용이 바뀌면 다시 발급받는다.'),
  ('SEAL_CERT', '법인인감증명서', 'days', 90, true, '등기소 · 인터넷등기소',
   array['인감\s*증명', '사용인감'], 110,
   '공공문서 기본 90일.')
on conflict (코드) do nothing;

-- -----------------------------------------------------------------------------
-- 4. 서류명 → 서류 종류. 하나의 요구가 두 종류를 가리킬 수 있다
--    (「국세·지방세 완납 증명서」는 국세와 지방세 둘 다다). 그래서 배열을 돌려준다.
-- -----------------------------------------------------------------------------
create or replace function app.서류종류들(서류명 text)
returns text[]
language sql stable as $$
  select coalesce(
    array_agg(t.코드 order by t.정렬),
    '{}'::text[]
  )
  from app.doc_types t
  where t.별칭 is not null
    and exists (
      select 1 from unnest(t.별칭) as p
       where 서류명 ~ p
    )
$$;

comment on function app.서류종류들(text) is
  '공고문이 쓴 서류명을 doc_types 코드 배열로. 못 알아보면 빈 배열 — null 이 아니라 빈 배열이다. '
  '「분류 안 됨」과 「분류 시도 안 함」을 화면이 구분할 수 있어야 한다.';

-- -----------------------------------------------------------------------------
-- 5. 공고문이 적어 둔 유효기간을 일수로 읽는다
--
--    실측 문구: "3개월 이내 발급분" · "1개월 이내" · "발행일로부터 2개월 이내" ·
--               "3개월 이내 발급, 유효기간 내 발급건" · "3개월 이내 발급한 서류만 유효"
--    거르는 것: "분량 17페이지 이내" · "공고일 기준 3년 이내"(서류 유효기간이 아니라 실적 시점)
-- -----------------------------------------------------------------------------
create or replace function app.공고유효일수(문구 text)
returns integer
language sql immutable as $$
  select case
    -- 분량·페이지 제한은 서류 유효기간이 아니다.
    when 문구 is null or 문구 ~ '페이지|분량|p 이내' then null
    -- 「N개월 이내」 → 30일 단위. 달마다 길이가 다르지만 공고가 개월로 말했으니 개월로 읽는다.
    when 문구 ~ '(\d+)\s*개월\s*(이내|내)' then
      (substring(문구 from '(\d+)\s*개월\s*(?:이내|내)'))::int * 30
    -- 「N일 이내」
    when 문구 ~ '(\d+)\s*일\s*(이내|내)' then
      (substring(문구 from '(\d+)\s*일\s*(?:이내|내)'))::int
    else null
  end
$$;

comment on function app.공고유효일수(text) is
  '공고문의 유효기간 문구 → 일수. 못 읽으면 null 이고, 그러면 서류 종류의 기본값(공공문서 90일)이 쓰인다. '
  '「3년 이내」 같은 실적 시점 조건과 「17페이지 이내」 같은 분량 조건은 걸러낸다.';

-- -----------------------------------------------------------------------------
-- 6. 요구서류에 종류·유효일수를 붙인다
-- -----------------------------------------------------------------------------
alter table app.ann_required_docs
  add column if not exists doc_types      text[],
  add column if not exists 유효기간_일수  integer;

update app.ann_required_docs
   set doc_types     = app.서류종류들(서류명),
       유효기간_일수 = app.공고유효일수(유효기간_문구);

create index if not exists idx_ard_doc_types on app.ann_required_docs using gin (doc_types);

-- -----------------------------------------------------------------------------
-- 7. 서류 종류별 요구 현황 — 「어차피 계속 낼 서류」가 여기서 나온다
-- -----------------------------------------------------------------------------
create or replace view app.v_doc_requirement as
select
  t.코드,
  count(distinct r.announcement_id)                                            as 요구공고수,
  count(distinct r.announcement_id) filter (where r.필수여부)                  as 필수공고수,
  -- 여러 공고가 서로 다르게 말하면 가장 짧은 것. 그래야 어느 공고에도 낼 수 있다.
  min(r.유효기간_일수) filter (where r.유효기간_일수 is not null)              as 공고_최단유효일수,
  -- 근거로 남긴다. 「90일이라고 누가 그랬는가」에 답할 수 있어야 한다.
  (array_agg(r.유효기간_문구 order by r.유효기간_일수 nulls last)
     filter (where r.유효기간_일수 is not null))[1]                            as 공고_유효기간_근거
from app.doc_types t
left join app.ann_required_docs r on t.코드 = any(r.doc_types)
group by t.코드;

-- -----------------------------------------------------------------------------
-- 8. 서류함 화면이 읽는 뷰 하나
--
--    유효기간 우선순위: 공고문 명시 > 서류 종류 기본(공공문서 90일).
--    「필수/참고」는 공고가 필수로 요구했는지로 정한다 — 사람이 정하지 않는다.
-- -----------------------------------------------------------------------------
create or replace view app.v_document_shelf as
with 보유 as (
  select distinct on (doc_type)
    doc_type, id, 발급일, 결산연도, 파일명, storage_path, created_at
  from app.documents
  order by doc_type, 발급일 desc nulls last, id desc
)
select
  t.코드,
  t.이름,
  t.발급처,
  t.공공문서,
  t.유효기간_종류,
  t.비고,
  coalesce(t.정렬, 999)                                     as 정렬,

  coalesce(q.요구공고수, 0)                                 as 요구공고수,
  coalesce(q.필수공고수, 0)                                 as 필수공고수,
  case when coalesce(q.필수공고수, 0) > 0 then '필수'
       when coalesce(q.요구공고수, 0) > 0 then '참고'
       else '미요구' end                                    as 구분,

  -- 적용되는 유효일수와 그 근거. 화면이 「왜 이 날짜인가」를 말할 수 있어야 한다.
  case when t.유효기간_종류 in ('days', 'months')
       then least(q.공고_최단유효일수,
                  coalesce(t.유효일수, t.유효개월 * 30, 2147483647))
       else null end                                        as 적용_유효일수,
  case when t.유효기간_종류 not in ('days', 'months')        then null
       when q.공고_최단유효일수 is not null
        and q.공고_최단유효일수 < coalesce(t.유효일수, t.유효개월 * 30, 2147483647)
       then '공고문 명시: ' || q.공고_유효기간_근거
       when t.공공문서 then '공공문서 기본 ' || coalesce(t.유효일수, t.유효개월 * 30) || '일'
       else '기본 ' || coalesce(t.유효일수, t.유효개월 * 30) || '일' end
                                                            as 유효기간_근거,

  d.발급일,
  d.결산연도,
  d.파일명,
  d.storage_path,
  d.id is not null                                          as 보유,

  case
    when d.id is null                       then null
    when t.유효기간_종류 not in ('days', 'months') then null
    when d.발급일 is null                   then null
    else (d.발급일 + (least(q.공고_최단유효일수,
                            coalesce(t.유효일수, t.유효개월 * 30, 2147483647))
                     || ' day')::interval)::date
  end                                                       as 만료일,

  case
    when d.id is null                              then '없음'
    when t.유효기간_종류 = 'permanent'             then '유효'
    when t.유효기간_종류 = 'per_notice'            then '공고확인필요'
    when t.유효기간_종류 = 'fiscal_year'           then
      case when d.결산연도 >= extract(year from now())::int - 1 then '유효' else '만료' end
    when d.발급일 is null                          then '확인필요'
    else
      case
        when (d.발급일 + (least(q.공고_최단유효일수,
                               coalesce(t.유효일수, t.유효개월 * 30, 2147483647))
                        || ' day')::interval)::date < current_date then '만료'
        when (d.발급일 + (least(q.공고_최단유효일수,
                               coalesce(t.유효일수, t.유효개월 * 30, 2147483647))
                        || ' day')::interval)::date < current_date + 30 then '만료임박'
        else '유효'
      end
  end                                                       as 상태
from app.doc_types t
left join app.v_doc_requirement q on q.코드 = t.코드
left join 보유 d on d.doc_type = t.코드;

comment on view app.v_document_shelf is
  '서류함 화면이 읽는 단 하나의 뷰. 서류 종류 x 우리 보유분 x 공고 요구 현황. '
  '유효기간은 공고문 명시가 종류 기본값(공공문서 90일)을 이긴다 — 근거를 같이 내보낸다.';

-- -----------------------------------------------------------------------------
-- 9. 공고가 요구했는데 종류로 못 묶은 서류 — 버리지 않고 따로 보여준다
-- -----------------------------------------------------------------------------
create or replace view app.v_doc_unmatched as
select
  r.서류명,
  count(distinct r.announcement_id)                          as 요구공고수,
  count(distinct r.announcement_id) filter (where r.필수여부) as 필수공고수,
  min(r.유효기간_일수)                                       as 공고_최단유효일수
from app.ann_required_docs r
where coalesce(array_length(r.doc_types, 1), 0) = 0
group by r.서류명
having count(*) >= 1;

comment on view app.v_doc_unmatched is
  '서류 종류로 못 묶은 요구서류. 대부분 서식(계획서·확약서·동의서)이라 보관 대상이 아니지만, '
  '빠뜨린 실제 증빙이 여기 섞여 있을 수 있어 조용히 버리지 않는다.';

commit;

-- 결과 확인
--   select 코드,이름,구분,요구공고수,필수공고수,적용_유효일수,유효기간_근거,상태
--     from app.v_document_shelf order by 정렬;

-- =============================================================================
-- ROLLBACK — 되돌릴 때만
-- =============================================================================
-- begin;
-- drop view if exists app.v_doc_unmatched;
-- drop view if exists app.v_document_shelf;
-- drop view if exists app.v_doc_requirement;
-- drop index if exists app.idx_ard_doc_types;
-- alter table app.ann_required_docs drop column if exists doc_types, drop column if exists 유효기간_일수;
-- drop function if exists app.공고유효일수(text);
-- drop function if exists app.서류종류들(text);
-- delete from app.doc_types where 코드 in ('SME_CERT','FACTORY','SEAL_CERT');
-- alter table app.doc_types
--   drop column if exists 유효일수, drop column if exists 공공문서,
--   drop column if exists 별칭, drop column if exists 발급처, drop column if exists 정렬;
-- commit;
