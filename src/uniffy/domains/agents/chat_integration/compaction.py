"""Scoped-view compaction for chat-surfaced agent conversations.

Phase 5 wraps `domains/agents/sessions/compaction.py` logic against
chat_messages, writing the summary back as an AGENT-authored message with
`metadata.kind='summary'` and `metadata.binding_id=<uuid>`, and updating
`agents_channel_bindings.last_compacted_at` + `compaction_summary_msg_ids`.

Phase 1 leaves this module intentionally empty; the file exists so the
package shape is final and imports across phases stay stable.
"""
