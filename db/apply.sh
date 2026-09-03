#!/usr/bin/env bash
# db/*.sql 한 파일을 Studio pg-meta 로 적용한다.
# mgnt1 은 docker·sudo·DB비번·psql 이 없어서 이 경로가 유일하다.
# (memory/announcement-board-schema.md 참조)
set -e
F="$1"
[ -f "$F" ] || { echo "파일 없음: $F"; exit 1; }

python3 - "$F" > /tmp/payload.json <<'PY'
import json, sys
sql = open(sys.argv[1], encoding='utf-8').read()
json.dump({"query": sql}, sys.stdout, ensure_ascii=False)
PY

echo "payload $(wc -c < /tmp/payload.json) bytes"
code=$(curl -s -o /tmp/resp.json -w '%{http_code}' --max-time 60 \
  -X POST http://100.110.60.7:3604/api/platform/pg-meta/default/query \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/payload.json)
echo "http=$code"
head -c 1200 /tmp/resp.json
echo
rm -f /tmp/payload.json /tmp/resp.json
