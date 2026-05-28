"""Password hashing utilities + shared email normalization helper."""

import bcrypt


def normalize_email(value: str | None) -> str:
    """Lowercase + trim - the canonical form for every read/write of an email.

    Email is treated case-insensitively across the system. Storing a
    canonical lowercased form keeps the unique index honest and lets
    every comparison use plain equality without ``func.lower``.
    """
    if value is None:
        return ""
    return value.strip().lower()


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Parameters
    ----------
    password : str
        Plain text password to hash.

    Returns
    -------
    str
        Hashed password string.

    """
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against a hashed password.

    Parameters
    ----------
    plain_password : str
        Plain text password to verify.
    hashed_password : str
        Hashed password to check against.

    Returns
    -------
    bool
        True if password matches, False otherwise.

    """
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )
