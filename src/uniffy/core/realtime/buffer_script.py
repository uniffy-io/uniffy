"""Atomic Valkey scripts that own buffered records, receipts and pending counters.

Each script checks its arguments and key types before the first write, because a Lua runtime
error does not undo writes that already ran.
"""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import valkey.asyncio as aioredis
from valkey.exceptions import NoScriptError

from uniffy.core.realtime.buffer_keys import RECORD_OVERHEAD_BYTES

# The shebang makes Valkey refuse a write script with OOM before it runs, never half way.
_PRELUDE = """#!lua
local function count(value)
  local number = tonumber(value)
  if number and number >= 0 and number == math.floor(number) then
    return number
  end
end

local function holds(key, kind)
  local found = redis.call('TYPE', key)['ok']
  return found == 'none' or found == kind
end

local function field(fields, name)
  for index = 1, #fields, 2 do
    if fields[index] == name then
      return fields[index + 1]
    end
  end
end

local function clock_ms()
  local now = redis.call('TIME')
  return tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
end

-- What a record costs in Valkey memory: its bytes, its id in the stream entry and the receipt,
-- and the fixed per-entry overhead.
local function record_cost(update_len, id_len)
  return update_len + 2 * id_len + RECORD_OVERHEAD
end

local function entry_cost(fields)
  return record_cost(#(field(fields, 'u') or ''), #(field(fields, 'i') or ''))
end

local function stream_cost(entries)
  local bytes = 0
  for _, entry in ipairs(entries) do
    bytes = bytes + entry_cost(entry[2])
  end
  return bytes
end

-- The organization is the first member segment; its pending bytes share the bucket hash.
local function organization_field(member)
  local organization = string.match(member, '^([^:]+):')
  return organization and ('o:' .. organization)
end

-- ``changed`` marks the totals as moved, so a running recount does not overwrite them.
local function charge(accounting, member, bytes, records, changed)
  if bytes == 0 and records == 0 then
    return
  end
  redis.call('HINCRBY', accounting, 'bytes', bytes)
  redis.call('HINCRBY', accounting, 'records', records)
  if changed then
    redis.call('HINCRBY', accounting, 'changes', 1)
  end
  local organization = organization_field(member)
  if organization and bytes ~= 0
      and redis.call('HINCRBY', accounting, organization, bytes) <= 0 then
    redis.call('HDEL', accounting, organization)
  end
end
""".replace("RECORD_OVERHEAD", str(RECORD_OVERHEAD_BYTES))

_ADMIT = """
local stream, control, receipts, due, accounting = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local early, scopes = KEYS[6], KEYS[7]
local update_id, update, digest, actor, member = ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5]
local watermark, byte_limit, record_limit = count(ARGV[6]), count(ARGV[7]), count(ARGV[8])
local budget, delay, max_record = count(ARGV[9]), count(ARGV[10]), count(ARGV[11])
local max_id, organization_limit = count(ARGV[12]), count(ARGV[14])
local early_bytes, early_records = count(ARGV[15]), count(ARGV[16])
if not (watermark and byte_limit and record_limit and budget and delay and max_record and max_id
    and organization_limit and early_bytes and early_records)
    or #update_id == 0 or #update_id > max_id or #update == 0 or #update > max_record
    or #digest ~= 64 or not string.match(digest, '^%x+$') or #actor ~= 36
    or not organization_field(member) then
  return {'type_error'}
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(receipts, 'hash')
    and holds(due, 'zset') and holds(accounting, 'hash') and holds(early, 'zset')
    and holds(scopes, 'set')) then
  return {'type_error'}
end

local receipt = redis.call('HGET', receipts, update_id)
if receipt then
  local seq, stored = string.match(receipt, '^(%d+):(%x+)$')
  if seq and stored == digest then
    return {'duplicate', tonumber(seq)}
  end
  return {'id_conflict'}
end

-- Only epoch initialization creates the control record. Recreating it here would restart the
-- sequence and could reissue a number an earlier client already holds a receipt for.
local state = redis.call('HMGET', control, 'head', 'bytes', 'records')
local head, pending_bytes, pending_records = count(state[1]), count(state[2]), count(state[3])
if not (head and pending_bytes and pending_records) or head < watermark then
  return {'recovery_required'}
end
local cost = record_cost(#update, #update_id)
if pending_bytes + cost > byte_limit or pending_records >= record_limit then
  return {'document_limit'}
end
if (count(redis.call('HGET', accounting, 'bytes')) or 0) + cost > budget then
  return {'budget_exhausted'}
end
local organization = organization_field(member)
if (count(redis.call('HGET', accounting, organization)) or 0) + cost > organization_limit then
  return {'organization_limit'}
end

local now_ms = clock_ms()
local seq = head + 1
local appended = redis.pcall('XADD', stream, string.format('%d-0', seq), 'i', update_id,
  'u', update, 'a', actor, 't', string.format('%d', now_ms), 'v', ARGV[13])
if type(appended) == 'table' and appended['err'] then
  return {'recovery_required'}
end
redis.call('HSET', control, 'head', seq, 'bytes', pending_bytes + cost,
  'records', pending_records + 1, 'last_ms', now_ms)
redis.call('HSETNX', control, 'first_ms', now_ms)
charge(accounting, member, cost, 1, true)
redis.call('HSET', receipts, update_id, string.format('%d:%s', seq, digest))
redis.call('ZADD', due, 'NX', count(redis.call('HGET', control, 'first_ms')) + delay, member)
if pending_bytes + cost > early_bytes or pending_records + 1 > early_records then
  redis.call('ZADD', early, 'NX', now_ms, member)
end
redis.call('SADD', scopes, member)
return {'accepted', seq}
"""

_TRIM = """
local stream, control, receipts, due, accounting = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local early, scopes = KEYS[6], KEYS[7]
local through, member, retire = count(ARGV[1]), ARGV[2], ARGV[3] == '1'
local delay, early_bytes, early_records = count(ARGV[4]), count(ARGV[5]), count(ARGV[6])
if not (through and delay and early_bytes and early_records) then
  return redis.error_reply('ERR buffer trim needs a sequence, a delay and early thresholds')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(receipts, 'hash')
    and holds(due, 'zset') and holds(accounting, 'hash') and holds(early, 'zset')
    and holds(scopes, 'set')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end

local entries = redis.call('XRANGE', stream, '-', string.format('%d-0', through))
local bytes, ids = stream_cost(entries), {}
for _, entry in ipairs(entries) do
  ids[#ids + 1] = field(entry[2], 'i')
end
if #entries > 0 then
  -- MINID removes ids strictly below the threshold, so through + 1 retires through itself.
  redis.call('XTRIM', stream, 'MINID', string.format('%d-0', through + 1))
end
local remaining = redis.call('XLEN', stream)

local released_bytes, released_records = bytes, #entries
local recorded = retire and redis.call('HMGET', control, 'bytes', 'records') or {}
local recorded_bytes, recorded_records = count(recorded[1]), count(recorded[2])
if recorded_bytes and recorded_records then
  -- The control also counts records a lost stream no longer holds; retiring releases them.
  local kept = stream_cost(redis.call('XRANGE', stream, '-', '+'))
  released_bytes, released_records = recorded_bytes - kept, recorded_records - remaining
end
charge(accounting, member, -released_bytes, -released_records, true)

if retire then
  if remaining == 0 then
    redis.call('DEL', stream)
    redis.call('SREM', scopes, member)
  end
  redis.call('DEL', control, receipts)
  redis.call('ZREM', due, member)
  redis.call('ZREM', early, member)
  return {bytes, #entries, remaining}
end

for first = 1, #ids, 512 do
  redis.call('HDEL', receipts, unpack(ids, first, math.min(first + 511, #ids)))
end
if redis.call('EXISTS', control) == 1 then
  if #entries > 0 then
    redis.call('HINCRBY', control, 'bytes', -bytes)
    redis.call('HINCRBY', control, 'records', -#entries)
  end
  if through > (count(redis.call('HGET', control, 'committed')) or 0) then
    redis.call('HSET', control, 'committed', through)
  end
  if remaining == 0 and (count(redis.call('HGET', control, 'head')) or 0) <= through then
    redis.call('HDEL', control, 'first_ms')
    redis.call('ZREM', due, member)
  elseif remaining > 0 then
    -- The surviving tail is due ten seconds after its oldest record, so a document edited
    -- during its checkpoint pass is not due again at once. GT keeps a later backoff.
    local oldest = redis.call('XRANGE', stream, '-', '+', 'COUNT', 1)[1]
    local accepted = oldest and count(field(oldest[2], 't'))
    if accepted then
      redis.call('HSET', control, 'first_ms', accepted)
      redis.call('ZADD', due, 'XX', 'GT', accepted + delay, member)
    end
  end
  local left = redis.call('HMGET', control, 'bytes', 'records')
  if (count(left[1]) or 0) <= early_bytes and (count(left[2]) or 0) <= early_records then
    redis.call('ZREM', early, member)
  end
end
return {bytes, #entries, remaining}
"""

_REPAIR = """
local stream, control, accounting = KEYS[1], KEYS[2], KEYS[3]
local member = ARGV[1]
if not organization_field(member) then
  return redis.error_reply('ERR buffer repair needs a member')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(accounting, 'hash')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end
local entries = redis.call('XRANGE', stream, '-', '+')
local bytes = stream_cost(entries)
if redis.call('EXISTS', control) == 1 then
  local recorded = redis.call('HMGET', control, 'bytes', 'records')
  redis.call('HSET', control, 'bytes', bytes, 'records', #entries)
  charge(accounting, member, bytes - (tonumber(recorded[1]) or 0),
    #entries - (tonumber(recorded[2]) or 0), false)
end
return {bytes, #entries}
"""

_REBASE = """
local accounting = KEYS[1]
if not holds(accounting, 'hash') then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end
if (redis.call('HGET', accounting, 'changes') or '0') ~= ARGV[1] then
  return 0
end
redis.call('HSET', accounting, 'bytes', ARGV[2], 'records', ARGV[3])
local organizations = {}
for index = 4, #ARGV, 2 do
  organizations['o:' .. ARGV[index]] = ARGV[index + 1]
end
for _, name in ipairs(redis.call('HKEYS', accounting)) do
  if string.sub(name, 1, 2) == 'o:' and not organizations[name] then
    redis.call('HDEL', accounting, name)
  end
end
for name, bytes in pairs(organizations) do
  redis.call('HSET', accounting, name, bytes)
end
return 1
"""

_INITIALIZE = """
local control, scopes = KEYS[1], KEYS[2]
if not (holds(control, 'hash') and holds(scopes, 'set')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end
redis.call('SADD', scopes, ARGV[2])
if redis.call('EXISTS', control) == 1 then
  return 0
end
redis.call('HSET', control, 'head', 0, 'bytes', 0, 'records', 0, 'committed', 0,
  'revision', ARGV[1], 'last_ms', clock_ms())
return 1
"""

_RECLAIM = """
local stream, control, receipts, due, accounting = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local early, scopes = KEYS[6], KEYS[7]
local watermark, member, cutoff = count(ARGV[1]), ARGV[2], count(ARGV[3])
if not (watermark and cutoff) or not organization_field(member) then
  return redis.error_reply('ERR buffer reclaim needs a watermark, a member and a cutoff')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(receipts, 'hash')
    and holds(due, 'zset') and holds(accounting, 'hash') and holds(early, 'zset')
    and holds(scopes, 'set')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end

-- Idle means PostgreSQL covers the head, nothing is scheduled and the last append is older than
-- the cutoff. Safety rests on the first two; a control without an append time is simply old.
local state = redis.call('HMGET', control, 'head', 'last_ms', 'bytes', 'records')
if count(state[1]) ~= watermark or redis.call('ZSCORE', due, member)
    or (count(state[2]) or 0) >= cutoff then
  return 0
end
-- Committed records a lost cleanup left in the stream still count against the bucket.
charge(accounting, member, -(count(state[3]) or 0), -(count(state[4]) or 0), true)
redis.call('DEL', stream, control, receipts)
redis.call('ZREM', early, member)
redis.call('SREM', scopes, member)
return 1
"""

_DROP_RETIRED = """
local stream, control, accounting, scopes = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local cutoff, member = count(ARGV[1]), ARGV[2]
if not cutoff or not organization_field(member) then
  return redis.error_reply('ERR buffer drop needs a cutoff and a member')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(accounting, 'hash')
    and holds(scopes, 'set')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end

-- A control record means the epoch still issues sequences; only a retired epoch loses records.
if redis.call('EXISTS', control) == 1 then
  return {0, 0}
end
local newest = redis.call('XREVRANGE', stream, '+', '-', 'COUNT', 1)[1]
if not newest then
  -- Neither control nor records remain, so nothing is left to track.
  redis.call('SREM', scopes, member)
  return {0, 0}
end
if (count(field(newest[2], 't')) or 0) >= cutoff then
  return {0, 0}
end
local entries = redis.call('XRANGE', stream, '-', '+')
local bytes = stream_cost(entries)
redis.call('DEL', stream)
redis.call('SREM', scopes, member)
charge(accounting, member, -bytes, -#entries, true)
return {bytes, #entries}
"""


@dataclass(frozen=True, slots=True)
class BufferScript:
    source: str
    sha: str


def _script(body: str) -> BufferScript:
    source = _PRELUDE + body
    return BufferScript(source, hashlib.sha1(source.encode(), usedforsecurity=False).hexdigest())


ADMIT_SCRIPT = _script(_ADMIT)
TRIM_SCRIPT = _script(_TRIM)
REPAIR_SCRIPT = _script(_REPAIR)
REBASE_SCRIPT = _script(_REBASE)
INITIALIZE_SCRIPT = _script(_INITIALIZE)
RECLAIM_SCRIPT = _script(_RECLAIM)
DROP_RETIRED_SCRIPT = _script(_DROP_RETIRED)


async def run_script(
    client: aioredis.Redis,
    script: BufferScript,
    keys: Sequence[str],
    args: Sequence[str | bytes | int],
) -> Any:
    try:
        return await client.evalsha(script.sha, len(keys), *keys, *args)
    except NoScriptError:
        # NOSCRIPT means the script never ran; loading it and running once more is safe.
        await client.script_load(script.source)
        return await client.evalsha(script.sha, len(keys), *keys, *args)
