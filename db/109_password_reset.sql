-- =============================================================================
-- 109_password_reset.sql — 비밀번호 재설정 요청 시각
--
--   이메일 발송 인프라가 이 프로젝트엔 없다(확인함 — bot·web 어디에도 SMTP 설정 없음).
--   그래서 "임시 비밀번호 자동 발송"이 아니라 "재설정 요청 → 관리자가 확인 후 발급"으로 간다.
--   요청 존재 여부는 app.users.reset_requested_at 하나로 충분하다(별도 테이블 불필요).
--
--   적용:    docker exec -i rnd-db psql -U postgres -d postgres < 109_password_reset.sql
--             (또는 db/psql.sh -f db/109_password_reset.sql)
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

alter table app.users add column if not exists reset_requested_at timestamptz;

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- alter table app.users drop column if exists reset_requested_at;
-- commit;
