import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OrgBudget(_message.Message):
    __slots__ = ("id", "organization_id", "monthly_limit", "image_monthly_limit", "hard_limit", "alert_thresholds", "reset_day", "created_at", "updated_at", "currency")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MONTHLY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    HARD_LIMIT_FIELD_NUMBER: _ClassVar[int]
    ALERT_THRESHOLDS_FIELD_NUMBER: _ClassVar[int]
    RESET_DAY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    monthly_limit: str
    image_monthly_limit: int
    hard_limit: bool
    alert_thresholds: _containers.RepeatedScalarFieldContainer[int]
    reset_day: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    currency: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., monthly_limit: _Optional[str] = ..., image_monthly_limit: _Optional[int] = ..., hard_limit: _Optional[bool] = ..., alert_thresholds: _Optional[_Iterable[int]] = ..., reset_day: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., currency: _Optional[str] = ...) -> None: ...

class UserQuota(_message.Message):
    __slots__ = ("id", "organization_id", "user_id", "daily_limit", "monthly_limit", "daily_image_limit", "monthly_image_limit", "hard_limit", "created_at", "updated_at", "currency")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DAILY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    DAILY_IMAGE_LIMIT_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_IMAGE_LIMIT_FIELD_NUMBER: _ClassVar[int]
    HARD_LIMIT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    user_id: str
    daily_limit: str
    monthly_limit: str
    daily_image_limit: int
    monthly_image_limit: int
    hard_limit: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    currency: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., daily_limit: _Optional[str] = ..., monthly_limit: _Optional[str] = ..., daily_image_limit: _Optional[int] = ..., monthly_image_limit: _Optional[int] = ..., hard_limit: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., currency: _Optional[str] = ...) -> None: ...

class SpendSummary(_message.Message):
    __slots__ = ("organization_id", "period_start", "period_end", "spend", "image_count", "pct_of_limit", "user_id", "currency")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERIOD_START_FIELD_NUMBER: _ClassVar[int]
    PERIOD_END_FIELD_NUMBER: _ClassVar[int]
    SPEND_FIELD_NUMBER: _ClassVar[int]
    IMAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    PCT_OF_LIMIT_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    period_start: _timestamp_pb2.Timestamp
    period_end: _timestamp_pb2.Timestamp
    spend: str
    image_count: int
    pct_of_limit: int
    user_id: str
    currency: str
    def __init__(self, organization_id: _Optional[str] = ..., period_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., period_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., spend: _Optional[str] = ..., image_count: _Optional[int] = ..., pct_of_limit: _Optional[int] = ..., user_id: _Optional[str] = ..., currency: _Optional[str] = ...) -> None: ...

class CurrencyRate(_message.Message):
    __slots__ = ("id", "organization_id", "from_currency", "to_currency", "rate", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    TO_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    RATE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    from_currency: str
    to_currency: str
    rate: str
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., from_currency: _Optional[str] = ..., to_currency: _Optional[str] = ..., rate: _Optional[str] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetOrgBudgetRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrgBudgetResponse(_message.Message):
    __slots__ = ("budget",)
    BUDGET_FIELD_NUMBER: _ClassVar[int]
    budget: OrgBudget
    def __init__(self, budget: _Optional[_Union[OrgBudget, _Mapping]] = ...) -> None: ...

class UpdateOrgBudgetRequest(_message.Message):
    __slots__ = ("organization_id", "monthly_limit", "image_monthly_limit", "hard_limit", "alert_thresholds", "reset_day", "currency")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MONTHLY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    HARD_LIMIT_FIELD_NUMBER: _ClassVar[int]
    ALERT_THRESHOLDS_FIELD_NUMBER: _ClassVar[int]
    RESET_DAY_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    monthly_limit: str
    image_monthly_limit: int
    hard_limit: bool
    alert_thresholds: _containers.RepeatedScalarFieldContainer[int]
    reset_day: int
    currency: str
    def __init__(self, organization_id: _Optional[str] = ..., monthly_limit: _Optional[str] = ..., image_monthly_limit: _Optional[int] = ..., hard_limit: _Optional[bool] = ..., alert_thresholds: _Optional[_Iterable[int]] = ..., reset_day: _Optional[int] = ..., currency: _Optional[str] = ...) -> None: ...

class UpdateOrgBudgetResponse(_message.Message):
    __slots__ = ("budget",)
    BUDGET_FIELD_NUMBER: _ClassVar[int]
    budget: OrgBudget
    def __init__(self, budget: _Optional[_Union[OrgBudget, _Mapping]] = ...) -> None: ...

class DeleteOrgBudgetRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class DeleteOrgBudgetResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetUserQuotaRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetUserQuotaResponse(_message.Message):
    __slots__ = ("quota",)
    QUOTA_FIELD_NUMBER: _ClassVar[int]
    quota: UserQuota
    def __init__(self, quota: _Optional[_Union[UserQuota, _Mapping]] = ...) -> None: ...

class UpdateUserQuotaRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "daily_limit", "monthly_limit", "daily_image_limit", "monthly_image_limit", "hard_limit", "currency")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DAILY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    DAILY_IMAGE_LIMIT_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_IMAGE_LIMIT_FIELD_NUMBER: _ClassVar[int]
    HARD_LIMIT_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    daily_limit: str
    monthly_limit: str
    daily_image_limit: int
    monthly_image_limit: int
    hard_limit: bool
    currency: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., daily_limit: _Optional[str] = ..., monthly_limit: _Optional[str] = ..., daily_image_limit: _Optional[int] = ..., monthly_image_limit: _Optional[int] = ..., hard_limit: _Optional[bool] = ..., currency: _Optional[str] = ...) -> None: ...

class UpdateUserQuotaResponse(_message.Message):
    __slots__ = ("quota",)
    QUOTA_FIELD_NUMBER: _ClassVar[int]
    quota: UserQuota
    def __init__(self, quota: _Optional[_Union[UserQuota, _Mapping]] = ...) -> None: ...

class DeleteUserQuotaRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class DeleteUserQuotaResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListUserQuotasRequest(_message.Message):
    __slots__ = ("organization_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListUserQuotasResponse(_message.Message):
    __slots__ = ("quotas", "pagination")
    QUOTAS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    quotas: _containers.RepeatedCompositeFieldContainer[UserQuota]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, quotas: _Optional[_Iterable[_Union[UserQuota, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class GetCurrentSpendRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetCurrentSpendResponse(_message.Message):
    __slots__ = ("summary",)
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    summary: SpendSummary
    def __init__(self, summary: _Optional[_Union[SpendSummary, _Mapping]] = ...) -> None: ...

class ListCurrencyRatesRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListCurrencyRatesResponse(_message.Message):
    __slots__ = ("rates",)
    RATES_FIELD_NUMBER: _ClassVar[int]
    rates: _containers.RepeatedCompositeFieldContainer[CurrencyRate]
    def __init__(self, rates: _Optional[_Iterable[_Union[CurrencyRate, _Mapping]]] = ...) -> None: ...

class UpsertCurrencyRateRequest(_message.Message):
    __slots__ = ("organization_id", "from_currency", "to_currency", "rate")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    TO_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    RATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    from_currency: str
    to_currency: str
    rate: str
    def __init__(self, organization_id: _Optional[str] = ..., from_currency: _Optional[str] = ..., to_currency: _Optional[str] = ..., rate: _Optional[str] = ...) -> None: ...

class UpsertCurrencyRateResponse(_message.Message):
    __slots__ = ("rate",)
    RATE_FIELD_NUMBER: _ClassVar[int]
    rate: CurrencyRate
    def __init__(self, rate: _Optional[_Union[CurrencyRate, _Mapping]] = ...) -> None: ...

class DeleteCurrencyRateRequest(_message.Message):
    __slots__ = ("organization_id", "from_currency", "to_currency")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    TO_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    from_currency: str
    to_currency: str
    def __init__(self, organization_id: _Optional[str] = ..., from_currency: _Optional[str] = ..., to_currency: _Optional[str] = ...) -> None: ...

class DeleteCurrencyRateResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class SetDisplayCurrencyRequest(_message.Message):
    __slots__ = ("organization_id", "display_currency")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    display_currency: str
    def __init__(self, organization_id: _Optional[str] = ..., display_currency: _Optional[str] = ...) -> None: ...

class SetDisplayCurrencyResponse(_message.Message):
    __slots__ = ("display_currency",)
    DISPLAY_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    display_currency: str
    def __init__(self, display_currency: _Optional[str] = ...) -> None: ...

class GetDisplayCurrencyRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetDisplayCurrencyResponse(_message.Message):
    __slots__ = ("display_currency",)
    DISPLAY_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    display_currency: str
    def __init__(self, display_currency: _Optional[str] = ...) -> None: ...
