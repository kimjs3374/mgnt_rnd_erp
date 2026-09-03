#!/usr/bin/env bash
# DB 에 붙는다. 팀원 누구나 쓴다 — docker 그룹도 sudo 도 필요 없다.
#
#   db/psql.sh                          대화형 셸
#   db/psql.sh -c "select 1"            한 줄 실행
#   db/psql.sh -f db/90_내스키마.sql     파일 실행
#   db/psql.sh -c "\\d app.expenses"     테이블 구조
#
# ⚠ 테이블을 새로 만들면 **웹·봇이 못 본다.** PostgREST 가 스키마를 캐시하기 때문이다.
#   404 가 나면 권한 문제가 아니라 이것이다. 그래서 명령을 끝낼 때마다 자동으로 캐시를 새로 읽힌다.
#
# ⚠ 스키마를 바꿨으면 반드시 db/ 에 .sql 로 남기고 커밋한다. CLAUDE.md §3.5 참조.
set -euo pipefail

ENV_FILE=/rnd/bot/.env.dev
if [[ ! -r "$ENV_FILE" ]]; then
  echo "접속 정보를 못 읽는다: $ENV_FILE" >&2
  echo "magnatech 그룹에 속해 있어야 한다. 김정수에게 말할 것." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# 대화형이면 그대로 넘긴다. 캐시 갱신은 사용자가 \q 로 나온 뒤 한 번.
if [[ $# -eq 0 ]]; then
  psql "$RND_DEV_DSN"
  psql "$RND_DEV_DSN" -q -c "notify pgrst, 'reload schema';" >/dev/null 2>&1 || true
  exit 0
fi

psql "$RND_DEV_DSN" "$@"
status=$?

# DDL 을 돌렸는지 알 수 없으니 매번 새로 읽힌다. 비용이 거의 없다.
psql "$RND_DEV_DSN" -q -c "notify pgrst, 'reload schema';" >/dev/null 2>&1 || true
exit $status
