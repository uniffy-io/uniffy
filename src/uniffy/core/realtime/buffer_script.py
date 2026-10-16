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
"""

_ADMIT = """
local stream, control, receipts, due, accounting = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local update_id, update, digest, actor, member = ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5]
local watermark, byte_limit, record_limit = count(ARGV[6]), count(ARGV[7]), count(ARGV[8])
local budget, delay, max_record = count(ARGV[9]), count(ARGV[10]), count(ARGV[11])
local max_id = count(ARGV[12])
if not (watermark and byte_limit and record_limit and budget and delay and max_record and max_id)
    or #update_id == 0 or #update_id > max_id or #update == 0 or #update > max_record
    or #digest ~= 64 or not string.match(digest, '^%x+$') or #actor ~= 36 or #member == 0 then
  return {'type_error'}
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(receipts, 'hash')
    and holds(due, 'zset') and holds(accounting, 'hash')) then
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
if pending_bytes + #update > byte_limit or pending_records >= record_limit then
  return {'document_limit'}
end
if (count(redis.call('HGET', accounting, 'bytes')) or 0) + #update > budget then
  return {'budget_exhausted'}
end

local now_ms = clock_ms()
local seq = head + 1
local appended = redis.pcall('XADD', stream, string.format('%d-0', seq), 'i', update_id,
  'u', update, 'a', actor, 't', string.format('%d', now_ms), 'v', ARGV[13])
if type(appended) == 'table' and appended['err'] then
  return {'recovery_required'}
end
redis.call('HSET', control, 'head', seq, 'bytes', pending_bytes + #update,
  'records', pending_records + 1, 'last_ms', now_ms)
redis.call('HSETNX', control, 'first_ms', now_ms)
redis.call('HINCRBY', accounting, 'bytes', #update)
redis.call('HINCRBY', accounting, 'records', 1)
redis.call('HINCRBY', accounting, 'changes', 1)
redis.call('HSET', receipts, update_id, string.format('%d:%s', seq, digest))
redis.call('ZADD', due, 'NX', count(redis.call('HGET', control, 'first_ms')) + delay, member)
return {'accepted', seq}
"""

_TRIM = """
local stream, control, receipts, due, accounting = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local through, member, retire = count(ARGV[1]), ARGV[2], ARGV[3] == '1'
if not through then
  return redis.error_reply('ERR buffer trim needs a sequence')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(receipts, 'hash')
    and holds(due, 'zset') and holds(accounting, 'hash')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end

local entries = redis.call('XRANGE', stream, '-', string.format('%d-0', through))
local bytes, ids = 0, {}
for _, entry in ipairs(entries) do
  bytes = bytes + #(field(entry[2], 'u') or '')
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
  local kept = 0
  for _, entry in ipairs(redis.call('XRANGE', stream, '-', '+')) do
    kept = kept + #(field(entry[2], 'u') or '')
  end
  released_bytes, released_records = recorded_bytes - kept, recorded_records - remaining
end
if released_bytes ~= 0 or released_records ~= 0 then
  redis.call('HINCRBY', accounting, 'bytes', -released_bytes)
  redis.call('HINCRBY', accounting, 'records', -released_records)
  redis.call('HINCRBY', accounting, 'changes', 1)
end

if retire then
  if remaining == 0 then
    redis.call('DEL', stream)
  end
  redis.call('DEL', control, receipts)
  redis.call('ZREM', due, member)
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
  -- A surviving tail keeps its original first pending time and due entry.
  if remaining == 0 and (count(redis.call('HGET', control, 'head')) or 0) <= through then
    redis.call('HDEL', control, 'first_ms')
    redis.call('ZREM', due, member)
  end
end
return {bytes, #entries, remaining}
"""

_REPAIR = """
local stream, control, accounting = KEYS[1], KEYS[2], KEYS[3]
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(accounting, 'hash')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end
local entries = redis.call('XRANGE', stream, '-', '+')
local bytes = 0
for _, entry in ipairs(entries) do
  bytes = bytes + #(field(entry[2], 'u') or '')
end
if redis.call('EXISTS', control) == 1 then
  local recorded = redis.call('HMGET', control, 'bytes', 'records')
  redis.call('HSET', control, 'bytes', bytes, 'records', #entries)
  redis.call('HINCRBY', accounting, 'bytes', bytes - (tonumber(recorded[1]) or 0))
  redis.call('HINCRBY', accounting, 'records', #entries - (tonumber(recorded[2]) or 0))
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
return 1
"""

_INITIALIZE = """
local control = KEYS[1]
if not holds(control, 'hash') then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end
if redis.call('EXISTS', control) == 1 then
  return 0
end
redis.call('HSET', control, 'head', 0, 'bytes', 0, 'records', 0, 'committed', 0,
  'revision', ARGV[1], 'last_ms', clock_ms())
return 1
"""

_RECLAIM = """
local stream, control, receipts, due, accounting = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local watermark, member, cutoff = count(ARGV[1]), ARGV[2], count(ARGV[3])
if not (watermark and cutoff) or #member == 0 then
  return redis.error_reply('ERR buffer reclaim needs a watermark, a member and a cutoff')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(receipts, 'hash')
    and holds(due, 'zset') and holds(accounting, 'hash')) then
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
local bytes, records = count(state[3]) or 0, count(state[4]) or 0
if bytes ~= 0 or records ~= 0 then
  redis.call('HINCRBY', accounting, 'bytes', -bytes)
  redis.call('HINCRBY', accounting, 'records', -records)
  redis.call('HINCRBY', accounting, 'changes', 1)
end
redis.call('DEL', stream, control, receipts)
return 1
"""

_DROP_RETIRED = """
local stream, control, accounting = KEYS[1], KEYS[2], KEYS[3]
local cutoff = count(ARGV[1])
if not cutoff then
  return redis.error_reply('ERR buffer drop needs a cutoff')
end
if not (holds(stream, 'stream') and holds(control, 'hash') and holds(accounting, 'hash')) then
  return redis.error_reply('WRONGTYPE buffer key holds another type')
end

-- A control record means the epoch still issues sequences; only a retired epoch loses records.
if redis.call('EXISTS', control) == 1 then
  return {0, 0}
end
local newest = redis.call('XREVRANGE', stream, '+', '-', 'COUNT', 1)[1]
if not newest or (count(field(newest[2], 't')) or 0) >= cutoff then
  return {0, 0}
end
local entries = redis.call('XRANGE', stream, '-', '+')
local bytes = 0
for _, entry in ipairs(entries) do
  bytes = bytes + #(field(entry[2], 'u') or '')
end
redis.call('DEL', stream)
redis.call('HINCRBY', accounting, 'bytes', -bytes)
redis.call('HINCRBY', accounting, 'records', -#entries)
redis.call('HINCRBY', accounting, 'changes', 1)
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
