"""Generic deployment-scope key-value settings.

Mirrors :mod:`uniffy.domains.org_settings` without the organization
scoping. First consumer is the system mail config; future deployment
knobs land here as new ``(namespace, key)`` rows.
"""

from uniffy.domains.deployment_settings.operations import DeploymentSettingsOperations

__all__ = ["DeploymentSettingsOperations"]
