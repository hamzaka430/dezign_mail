#!/bin/bash
set -e

TO="$1"
FROM="$2"
SUBJECT="$3"
BODY=$(cat)
API_URL="${DEZIGNMAIL_API_URL:-https://dezignmail.pages.dev/api/receive}"
SECRET="${POSTFIX_WEBHOOK_SECRET}"

PAYLOAD=$(python3 -c "
import json, sys
data = {
  'to': sys.argv[1],
  'from': sys.argv[2],
  'subject': sys.argv[3],
  'body': sys.argv[4]
}
print(json.dumps(data))
" "$TO" "$FROM" "$SUBJECT" "$BODY")

curl -s -X POST "$API_URL" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 10 \
  --retry 3 \
  || echo "[dezignmail] API delivery failed" >&2

exit 0