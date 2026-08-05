"""Per-call usage accounting for one agent run."""

from dataclasses import dataclass, field
from decimal import Decimal
from uuid import UUID

from uniffy.domains.agents.pricing import compute_text_cost, get_pricing
from uniffy.domains.agents.providers.base import CompletionResult


@dataclass(frozen=True, slots=True)
class ModelCallUsage:
    sequence: int
    provider: str
    provider_key_id: UUID | None
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    thinking_tokens: int = 0
    status: str = "success"
    error: str | None = None

    def cost_usd(self) -> Decimal | None:
        pricing = get_pricing(provider=self.provider, model=self.model)
        if pricing is None:
            return None
        return compute_text_cost(
            pricing,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_creation_input_tokens=self.cache_creation_input_tokens,
            cache_read_input_tokens=self.cache_read_input_tokens,
            thinking_tokens=self.thinking_tokens,
        )

    def to_dict(self) -> dict:
        cost = self.cost_usd()
        return {
            "sequence": self.sequence,
            "provider": self.provider,
            "provider_key_id": (str(self.provider_key_id) if self.provider_key_id else None),
            "model": self.model,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_creation_input_tokens": self.cache_creation_input_tokens,
            "cache_read_input_tokens": self.cache_read_input_tokens,
            "thinking_tokens": self.thinking_tokens,
            "status": self.status,
            "error": self.error,
            "cost_usd": str(cost) if cost is not None else None,
        }


@dataclass(slots=True)
class RunUsageAccumulator:
    calls: list[ModelCallUsage] = field(default_factory=list)

    def record_result(
        self,
        *,
        provider: str,
        provider_key_id: UUID | None,
        result: CompletionResult,
    ) -> None:
        self.calls.append(
            ModelCallUsage(
                sequence=len(self.calls) + 1,
                provider=provider,
                provider_key_id=provider_key_id,
                model=result.model,
                input_tokens=max(0, int(result.input_tokens or 0)),
                output_tokens=max(0, int(result.output_tokens or 0)),
                cache_creation_input_tokens=max(0, int(result.cache_creation_input_tokens or 0)),
                cache_read_input_tokens=max(0, int(result.cache_read_input_tokens or 0)),
                thinking_tokens=max(0, int(result.thinking_tokens or 0)),
            )
        )

    def record_failure(
        self,
        *,
        provider: str,
        provider_key_id: UUID | None,
        model: str,
        error: str,
    ) -> None:
        self.calls.append(
            ModelCallUsage(
                sequence=len(self.calls) + 1,
                provider=provider,
                provider_key_id=provider_key_id,
                model=model,
                status="error",
                error=error,
            )
        )

    @property
    def input_tokens(self) -> int:
        return sum(call.input_tokens for call in self.calls)

    @property
    def output_tokens(self) -> int:
        return sum(call.output_tokens for call in self.calls)

    @property
    def cache_creation_input_tokens(self) -> int:
        return sum(call.cache_creation_input_tokens for call in self.calls)

    @property
    def cache_read_input_tokens(self) -> int:
        return sum(call.cache_read_input_tokens for call in self.calls)

    @property
    def thinking_tokens(self) -> int:
        return sum(call.thinking_tokens for call in self.calls)

    @property
    def last_model(self) -> str | None:
        return self.calls[-1].model if self.calls else None

    @property
    def last_provider_key_id(self) -> UUID | None:
        return self.calls[-1].provider_key_id if self.calls else None

    @property
    def retry_count(self) -> int:
        return sum(call.status == "error" for call in self.calls)

    @property
    def failover_provider_key_ids(self) -> list[str]:
        if not self.calls:
            return []
        primary = self.calls[0].provider_key_id
        seen: set[UUID] = set()
        keys: list[str] = []
        for call in self.calls[1:]:
            key_id = call.provider_key_id
            if key_id is None or key_id == primary or key_id in seen:
                continue
            seen.add(key_id)
            keys.append(str(key_id))
        return keys

    @property
    def deadline_exceeded(self) -> bool:
        return any(call.error == "TimeoutError" for call in self.calls)

    def cost_usd(self) -> Decimal | None:
        total = Decimal(0)
        for call in self.calls:
            if call.status != "success":
                continue
            cost = call.cost_usd()
            if cost is None:
                return None
            total += cost
        return total.quantize(Decimal("0.000001"))

    def to_list(self) -> list[dict]:
        return [call.to_dict() for call in self.calls]
