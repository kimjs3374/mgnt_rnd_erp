-- =============================================================================
-- 71_ann_required_docs.sql — 공고별 요구서류: 판독 근거·확신도 컬럼 추가
--
--   최초 계획은 이 이름으로 새 테이블을 만드는 것이었으나, app.ann_required_docs 는
--   이미 존재했다(2026-09-02 초기 시드, id·announcement_id·doc_type·서류명·
--   필수여부(boolean)·유효기간_문구·원문). db/*.sql 에 CREATE 문이 없어서 없는
--   줄 알았던 것 — 라이브 DB 를 먼저 조회했어야 했다. 기존 테이블·데이터는 건드리지
--   않고 컬럼만 추가한다.
--
--   왜 추가하는가
--     기존 스키마엔 「필수/해당시/가점」 3분류 대신 boolean 하나뿐이고, 판독 근거·
--     확신도를 남길 자리가 없다. 이 프로젝트의 반복되는 설계 원칙 —
--     ① 근거문장을 원문 그대로 저장한다(판독 검증 가능해야 함)
--     ② 확신도 0.70 미만은 코드로 자동 확정을 막는다
--     — 를 지키려면 최소 세 컬럼이 필요하다. 기존 필수여부·doc_type 은 그대로 둔다
--     (다른 화면이 이미 그 컬럼을 읽고 있을 수 있어서 이름을 바꾸거나 없애지 않는다).
--
--   설계 원칙: 추가만 한다. DROP·ALTER TYPE·롤 DDL 없음.
--   RLS·권한은 이미 걸려 있음(확인 완료: relrowsecurity=true, authenticated SELECT,
--   service_role ALL, policy authenticated_read_ann_required_docs 존재) — 손대지 않는다.
--
--   적용: pg-meta(172.20.0.6:8080, supabase_admin) 로 직접 실행. docker·psql·DB
--   비번 없이 접근하는 방법은 rnd-meta 컨테이너가 host 에서도 도달 가능한 사설
--   IP 라는 점을 이용한 것 — Studio(rnd-db.mgnt.kr)가 내부적으로 쓰는 것과 같은 경로다.
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

alter table app.ann_required_docs
  add column if not exists 구분       text,     -- 필수 | 해당시 | 가점 | 확인필요. 기존 필수여부(boolean)는 그대로 둔다
  add column if not exists 근거문장   text,     -- 공고문에서 그대로 인용. 지어낸 서류인지 검증하는 유일한 근거
  add column if not exists ai_확신도  numeric,  -- LLM 판독 확신도
  add column if not exists 확인상태   text not null default '미확인';  -- 미확인 | 확인됨 | 확인필요

comment on column app.ann_required_docs.구분 is
  '필수/해당시 구분이 원문 텍스트 추출 중 깨지는 경우가 실증에서 확인됐다(레이아웃 붕괴). '
  '애매하면 "확인필요"로 두고 단정하지 않는다.';
comment on column app.ann_required_docs.근거문장 is
  '공고문에서 그대로 인용. 지어낸 서류인지 검증하는 유일한 근거.';
comment on column app.ann_required_docs.ai_확신도 is
  'LLM 판독 확신도. 0.70 미만은 코드로 자동 확정을 막는다(§5 설계 원칙).';

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- alter table app.ann_required_docs
--   drop column if exists 구분,
--   drop column if exists 근거문장,
--   drop column if exists ai_확신도,
--   drop column if exists 확인상태;
-- notify pgrst, 'reload schema';
