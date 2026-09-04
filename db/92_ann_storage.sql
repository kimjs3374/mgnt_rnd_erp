-- =============================================================================
-- 92_ann_storage.sql — 공고문 파일을 우리 Supabase Storage 에도 보관한다
--
--   왜: 지금까지는 기업마당·IRIS 원본 서버 URL만 링크했다. 그 서버가 파일을 내리거나
--   URL 구조를 바꾸면(실측: IRIS 는 마감 지난 공고가 목록 API 에서 아예 빠진다) 다운로드가
--   조용히 끊긴다. 원본을 우리 버킷에 복사해 두면 그런 일과 무관하게 항상 받을 수 있다.
--
--   버킷: "announcements" (public) — storage.buckets 는 이 SQL 이 아니라
--   scripts/lib/storage.mjs 의 ensureBucket() 이 Storage HTTP API 로 만든다
--   (storage.buckets 는 service_role 도 직접 INSERT 권한이 없어 API 를 거쳐야 한다).
--
--   원본 URL(공고문_url)은 그대로 둔다 — 출처 확인용 근거로 남긴다. 지우지 않는다.
--
--   적용: db/psql.sh 로는 안 된다 — app.announcements 는 supabase_admin 소유라
--   rnd_dev 로는 "must be owner of table" 로 막힌다(실측). pg-meta(172.20.0.6:8080,
--   supabase_admin)로 실행했다 — memory/[[solverton_pgmeta_direct_access]] 참고.
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

alter table app.announcements
  add column if not exists 공고문_bucket_url text;

comment on column app.announcements.공고문_bucket_url is
  '우리 Supabase Storage(버킷 announcements)에 복사해 둔 공고문 파일의 공개 URL. '
  '원본(공고문_url)이 나중에 끊겨도 이 URL은 우리가 지운 적 없는 한 계속 산다.';

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- alter table app.announcements drop column if exists 공고문_bucket_url;
-- notify pgrst, 'reload schema';
