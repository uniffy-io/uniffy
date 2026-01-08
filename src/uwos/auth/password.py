"""Password hashing utilities."""

import bcrypt


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
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
