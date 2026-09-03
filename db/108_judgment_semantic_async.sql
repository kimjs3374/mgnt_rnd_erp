-- =============================================================================
-- 108_judgment_semantic_async.sql — 임베딩을 저장 이후로 미룬다
--
--   사용자 지적(2026-09-04): "DB에 올리고 모델은 백그라운드에서 작업하면 되지
--   저장할때마다 모델호출하면 서버리소스가 남아나겠냐" — 맞다. 지금까지는
--   record_judgment() 가 텍스트를 저장하기 **전에** 임베딩을 계산해서 요청 하나가
--   통째로 그 시간(콜드스타트 8~12초, 상주서버로 고친 뒤엔 0.2초대)에 묶여
--   있었다. 저장은 즉시 끝나야 한다 — 임베딩은 검색에만 필요하지 저장 자체와는
--   상관없다.
--
--   임베딩 컬럼을 nullable 로 바꾼다. 저장은 임베딩 없이 먼저 끝내고, 게이트웨이가
--   응답을 보낸 **뒤에** 백그라운드 스레드로 채운다(bot/gateway.py). 채워지기
--   전까지 그 행은 검색(find_similar)에서 조용히 빠진다 — 없는 척하지 않고,
--   그냥 "아직 준비 안 됨"으로 스킵한다(기존 코드가 이미 그렇게 짜여 있었다 —
--   isinstance(벡터, list) 검사가 None 을 자연스럽게 걸러낸다).
--
--   설계 원칙: 추가만 한다. DROP·데이터 삭제 없음.
--   적용:     cd /web/rnd && ./db/psql.sh -f db/108_judgment_semantic_async.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

alter table app.judgment_semantic alter column 임베딩 drop not null;

comment on column app.judgment_semantic.임베딩 is
  'jsonb 배열(768차원, jhgan/ko-sroberta-multitask) 또는 null. null 이면 아직 '
  '백그라운드에서 계산 중이거나 실패한 것이다 — find_similar() 가 조용히 건너뛴다. '
  '저장 자체는 임베딩을 기다리지 않는다(2026-09-04, 응답 지연 신고로 바꿈).';

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- alter table app.judgment_semantic alter column 임베딩 set not null;
-- notify pgrst, 'reload schema';
