from uniffy.domains.agents.providers.openai.converters import convert_messages_to_openai


def test_openai_tool_arguments_remain_json_strings() -> None:
    messages = convert_messages_to_openai(
        [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "call_1",
                        "name": "notes.search",
                        "input": {"query": "roadmap"},
                    }
                ],
            }
        ],
        system=None,
    )

    arguments = messages[0]["tool_calls"][0]["function"]["arguments"]
    assert arguments == '{"query":"roadmap"}'
    assert isinstance(arguments, str)
