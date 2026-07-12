#!/usr/bin/env bash
#
# Test that Valkey pub/sub subscriptions are cleaned up when clients disconnect.
#
# Verifies that the StreamDisconnectMiddleware + aclosing() cleanup chain works
# correctly under Granian. Cleanup happens when the next heartbeat send fails
# (~30s worst case).
#
# Prerequisites:
#   - Backend running (./manage.py serve backend)
#   - Docker compose stack running (valkey)
#   - A valid JWT token and organization ID
#
# Usage:
#   ./scripts/test-stream-cleanup.sh <JWT_TOKEN> <ORG_ID> [NUM_CLIENTS] [HOLD_SECONDS]

set -euo pipefail

TOKEN="${1:?Usage: $0 <JWT_TOKEN> <ORG_ID> [NUM_CLIENTS] [HOLD_SECONDS]}"
ORG_ID="${2:?Usage: $0 <JWT_TOKEN> <ORG_ID> [NUM_CLIENTS] [HOLD_SECONDS]}"
NUM_CLIENTS="${3:-5}"
HOLD_SECONDS="${4:-3}"
API_URL="${API_URL:-http://localhost:8000}"
VALKEY_PASSWORD="${VALKEY_PASSWORD:-uniffy-valkey-dev}"

ENDPOINT="/api/notifications.v1.NotificationsService/StreamNotifications"

# Extract user_id from JWT payload to know which channel to monitor
JWT_PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
USER_ID=$(echo "$JWT_PAYLOAD" | base64 -d 2>/dev/null || true)
USER_ID=$(echo "$USER_ID" | uv run python -c "import sys,json; print(json.load(sys.stdin)['sub'])")
USER_CHANNEL="notifications:$USER_ID"

# Build the Connect streaming envelope: 1 byte flags (0x00) + 4 bytes big-endian length + JSON
TMPFILE=$(mktemp)
uv run python -c "
import struct, sys
payload = b'{\"organizationId\":\"$ORG_ID\"}'
sys.stdout.buffer.write(struct.pack('>BI', 0, len(payload)) + payload)
" > "$TMPFILE"

cleanup() {
  rm -f "$TMPFILE"
  # Kill any leftover curl processes from this script
  for pid in "${PIDS[@]:-}"; do
    kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

numsub() {
  docker compose exec -T valkey \
    valkey-cli -a "$VALKEY_PASSWORD" --no-auth-warning \
    PUBSUB NUMSUB "$USER_CHANNEL" 2>/dev/null | tail -1
}

echo "=== Stream Cleanup Test ==="
echo "Clients:      $NUM_CLIENTS"
echo "Hold time:    ${HOLD_SECONDS}s"
echo "User channel: $USER_CHANNEL"
echo "Endpoint:     $API_URL$ENDPOINT"
echo ""

echo "[1/5] Checking baseline subscriber count..."
BASELINE=$(numsub)
echo "       Subscribers: $BASELINE"
echo ""

echo "[2/5] Opening $NUM_CLIENTS streaming connections..."
PIDS=()
for i in $(seq 1 "$NUM_CLIENTS"); do
  curl -sN \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/connect+json" \
    -H "Connect-Protocol-Version: 1" \
    --data-binary "@$TMPFILE" \
    "$API_URL$ENDPOINT" > /dev/null 2>&1 &
  PIDS+=($!)
done
echo "       PIDs: ${PIDS[*]}"
echo ""

echo "[3/5] Holding connections for ${HOLD_SECONDS}s..."
sleep "$HOLD_SECONDS"
DURING=$(numsub)
EXPECTED=$((BASELINE + NUM_CLIENTS))
echo "       Subscribers: $DURING (expected: $EXPECTED)"

if [ "$DURING" -le "$BASELINE" ]; then
  echo "       FAIL: No new subscriptions detected."
  echo "       Check that the backend is running, the token is valid, and the org ID is correct."
  exit 1
fi
echo ""

echo "[4/5] Killing all clients (SIGKILL, simulating abrupt disconnect)..."
for pid in "${PIDS[@]}"; do
  kill -9 "$pid" 2>/dev/null || true
done
wait "${PIDS[@]}" 2>/dev/null || true
PIDS=()
echo "       All clients killed."
echo ""

echo "[5/5] Waiting for cleanup (up to 45s, heartbeat interval is 30s)..."
LEAKED=true
for i in $(seq 1 45); do
  sleep 1
  AFTER=$(numsub)
  echo "       ${i}s - subscribers: $AFTER"
  if [ "$AFTER" -le "$BASELINE" ]; then
    LEAKED=false
    break
  fi
done

echo ""
echo "=== Results ==="
echo "Before:  $BASELINE subscribers"
echo "During:  $DURING subscribers"
echo "After:   $AFTER subscribers"
echo ""

if [ "$LEAKED" = true ]; then
  LEAK_COUNT=$((AFTER - BASELINE))
  echo "FAIL: $LEAK_COUNT subscription(s) leaked after 45s."
  exit 1
else
  echo "PASS: All subscriptions cleaned up."
  exit 0
fi
