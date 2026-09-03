-- =============================================================================
-- 70_storage_rls.sql — 증빙 파일 접근 정책
--
--   배경: storage.objects·buckets 는 RLS 가 켜져 있는데 **정책이 0개**였다.
--         service_role 은 bypassrls 라 통과하지만 나머지는 전부 막힌다.
--         로그인을 붙이면 사용자가 증빙을 열어야 하는데 지금 상태로는 못 연다.
--
--   설계
--     · anon  — 아무것도 못 한다. 증빙은 공개 대상이 아니다.
--     · authenticated — `evidence` 버킷 **읽기만**. 업로드·삭제는 못 한다.
--     · 쓰기는 service_role(서버)만. 봇이 확정 시점에 올린다.
--       사용자가 직접 올리면 어느 집행 건에 속하는지 알 수 없고, 정산 원장이 흐려진다.
--
--   적용:    docker exec -i rnd-db psql -U postgres -d postgres < 70_storage_rls.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

-- 버킷 목록을 못 읽으면 그 안의 파일도 못 연다.
grant select on storage.buckets to authenticated;
grant select on storage.objects to authenticated;

-- anon 은 명시적으로 막는다. 나중에 누가 무심코 열지 않도록 못을 박는다.
revoke all on storage.objects from anon;
revoke all on storage.buckets from anon;

-- ── 버킷 ──────────────────────────────────────────────────────────────────
drop policy if exists "authenticated_read_evidence_bucket" on storage.buckets;
create policy "authenticated_read_evidence_bucket"
  on storage.buckets for select
  to authenticated
  using (id = 'evidence');

-- ── 오브젝트 ──────────────────────────────────────────────────────────────
drop policy if exists "authenticated_read_evidence_objects" on storage.objects;
create policy "authenticated_read_evidence_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'evidence');

-- ⚠ INSERT·UPDATE·DELETE 정책을 **일부러 만들지 않는다.**
--    정책이 없으면 RLS 가 거부한다. 쓰기는 service_role(bypassrls)만 가능하다.
--    증빙은 봇이 「확정」 시점에만 올린다. 사람이 직접 올리는 경로를 두지 않는다.

comment on table storage.objects is
  'RLS: authenticated=evidence 읽기전용 · anon=차단 · 쓰기는 service_role 만. '
  '정책 없음 = 거부. 증빙 업로드는 봇이 확정 시점에 한다 (2026-09-03).';

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists "authenticated_read_evidence_objects" on storage.objects;
-- drop policy if exists "authenticated_read_evidence_bucket"  on storage.buckets;
-- commit;
