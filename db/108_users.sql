-- =============================================================================
-- 108_users.sql — 자체 회원(아이디/비밀번호) 계정 테이블
--
--   Supabase Auth(GoTrue)를 쓰지 않는다. 아이디 로그인을 GoTrue로 하려면
--   아이디→이메일 매핑을 따로 둬야 해서 오히려 복잡해진다.
--   대신 app.users에 아이디·비밀번호 해시를 직접 두고, 세션은 서버가 서명한
--   쿠키로 관리한다(app/actions/auth.ts 예정).
--
--   비밀번호는 평문 저장 안 함 — Node 내장 crypto.scrypt로 해시(salt 포함, lib/password.ts).
--   service_role만 이 테이블을 만질 수 있다. anon·authenticated는 전부 차단(RLS 정책 없음).
--
--   적용:    docker exec -i rnd-db psql -U postgres -d postgres < 108_users.sql
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

create table app.users (
  id            bigserial primary key,
  username      text unique not null,
  password_hash text not null,          -- 'salt:hash' 형식 (scrypt)
  name          text not null,          -- 이름
  phone         text,                   -- 연락처
  email         text,                   -- 이메일
  department    text,                   -- 소속 부서
  role          text not null default 'member' check (role in ('member', 'admin')),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by   bigint references app.users(id),
  approved_at   timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- 이메일은 입력 안 할 수도 있으니(비필수) NULL은 중복 허용, 값이 있으면 유일해야 한다.
create unique index users_email_key on app.users (email) where email is not null;

alter table app.users enable row level security;
-- 정책을 하나도 안 건다 → anon·authenticated는 전부 거부(default deny), service_role만 통과(bypassrls=true).

revoke all on app.users from anon, authenticated;
grant all on app.users to service_role;
grant usage, select on sequence app.users_id_seq to service_role;

comment on table app.users is
  '자체 로그인 계정(아이디/비밀번호). Supabase Auth 미사용 — 세션은 서버 서명 쿠키.';

commit;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop table if exists app.users;
-- commit;
