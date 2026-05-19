import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ModelPricing(_message.Message):
    __slots__ = ("id", "provider", "model", "kind", "input_per_1m", "output_per_1m", "cached_input_per_1m", "thinking_per_1m", "image_prices", "effective_from", "effective_to", "created_at", "updated_at", "currency")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    INPUT_PER_1M_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PER_1M_FIELD_NUMBER: _ClassVar[int]
    CACHED_INPUT_PER_1M_FIELD_NUMBER: _ClassVar[int]
    THINKING_PER_1M_FIELD_NUMBER: _ClassVar[int]
    IMAGE_PRICES_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_FROM_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_TO_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    id: str
    provider: str
    model: str
    kind: str
    input_per_1m: str
    output_per_1m: str
    cached_input_per_1m: str
    thinking_per_1m: str
    image_prices: _containers.RepeatedCompositeFieldContainer[ImagePrice]
    effective_from: _timestamp_pb2.Timestamp
    effective_to: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    currency: str
    def __init__(self, id: _Optional[str] = ..., provider: _Optional[str] = ..., model: _Optional[str] = ..., kind: _Optional[str] = ..., input_per_1m: _Optional[str] = ..., output_per_1m: _Optional[str] = ..., cached_input_per_1m: _Optional[str] = ..., thinking_per_1m: _Optional[str] = ..., image_prices: _Optional[_Iterable[_Union[ImagePrice, _Mapping]]] = ..., effective_from: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., effective_to: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., currency: _Optional[str] = ...) -> None: ...

class ImagePrice(_message.Message):
    __slots__ = ("size", "quality", "price")
    SIZE_FIELD_NUMBER: _ClassVar[int]
    QUALITY_FIELD_NUMBER: _ClassVar[int]
    PRICE_FIELD_NUMBER: _ClassVar[int]
    size: str
    quality: str
    price: str
    def __init__(self, size: _Optional[str] = ..., quality: _Optional[str] = ..., price: _Optional[str] = ...) -> None: ...

class ListModelPricingRequest(_message.Message):
    __slots__ = ("provider", "kind", "as_of")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    AS_OF_FIELD_NUMBER: _ClassVar[int]
    provider: str
    kind: str
    as_of: _timestamp_pb2.Timestamp
    def __init__(self, provider: _Optional[str] = ..., kind: _Optional[str] = ..., as_of: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListModelPricingResponse(_message.Message):
    __slots__ = ("rows",)
    ROWS_FIELD_NUMBER: _ClassVar[int]
    rows: _containers.RepeatedCompositeFieldContainer[ModelPricing]
    def __init__(self, rows: _Optional[_Iterable[_Union[ModelPricing, _Mapping]]] = ...) -> None: ...

class UpsertModelPricingRequest(_message.Message):
    __slots__ = ("provider", "model", "kind", "input_per_1m", "output_per_1m", "cached_input_per_1m", "thinking_per_1m", "image_prices", "effective_from", "effective_to", "currency")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    INPUT_PER_1M_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PER_1M_FIELD_NUMBER: _ClassVar[int]
    CACHED_INPUT_PER_1M_FIELD_NUMBER: _ClassVar[int]
    THINKING_PER_1M_FIELD_NUMBER: _ClassVar[int]
    IMAGE_PRICES_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_FROM_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_TO_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    provider: str
    model: str
    kind: str
    input_per_1m: str
    output_per_1m: str
    cached_input_per_1m: str
    thinking_per_1m: str
    image_prices: _containers.RepeatedCompositeFieldContainer[ImagePrice]
    effective_from: _timestamp_pb2.Timestamp
    effective_to: _timestamp_pb2.Timestamp
    currency: str
    def __init__(self, provider: _Optional[str] = ..., model: _Optional[str] = ..., kind: _Optional[str] = ..., input_per_1m: _Optional[str] = ..., output_per_1m: _Optional[str] = ..., cached_input_per_1m: _Optional[str] = ..., thinking_per_1m: _Optional[str] = ..., image_prices: _Optional[_Iterable[_Union[ImagePrice, _Mapping]]] = ..., effective_from: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., effective_to: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., currency: _Optional[str] = ...) -> None: ...

class ModelPricingResponse(_message.Message):
    __slots__ = ("row",)
    ROW_FIELD_NUMBER: _ClassVar[int]
    row: ModelPricing
    def __init__(self, row: _Optional[_Union[ModelPricing, _Mapping]] = ...) -> None: ...

class DeleteModelPricingRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class DeleteModelPricingResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
