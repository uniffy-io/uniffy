"""Default caps used when no per-user or per-org row governs a bucket.

Defaults are deliberately lenient for text spend (no default dollar cap)
and moderately restrictive for image generation (which is an order of
magnitude more expensive per call). Deployments that need tighter caps
configure them via ``agents.v1.BudgetsService``.
"""

# Per-user daily image-generation cap applied when no AgentUserQuota row
# exists for the user (or the row's ``daily_image_limit`` is null).
DEFAULT_DAILY_IMAGE_LIMIT_PER_USER = 20

# Per-organization monthly image-generation cap applied when no
# AgentBudget row exists (or the row's ``image_monthly_limit`` is null).
DEFAULT_MONTHLY_IMAGE_LIMIT_PER_ORG = 500
