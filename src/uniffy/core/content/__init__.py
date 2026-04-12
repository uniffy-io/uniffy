"""
Content module: base classes and utilities for content operations.

This package intentionally exports nothing at the package level. Import
from the specific submodule you need to avoid triggering heavyweight
initialization (the base operations class pulls in the permission
checker, which pulls in the models, and so on).

Usage::

    from uniffy.core.content.base_operations import BaseContentOperations
    from uniffy.core.content.members import ContentMembersOperations
    from uniffy.core.content.model_mixins import (
        access_mode_field,
        baseline_role_field,
        is_deleted_field,
    )
"""

__all__: list[str] = []
