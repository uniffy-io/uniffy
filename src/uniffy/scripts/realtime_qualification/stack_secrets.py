"""Write random per-stack secrets that only the qualification containers can read."""

import base64
import os
import secrets
import sys
from pathlib import Path


def main() -> None:
    target = Path(sys.argv[1]) / "stack.env"
    if target.exists():
        return
    values = {
        "JWT_SECRET_KEY": secrets.token_hex(32),
        "APP_MASTER_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        "INITIAL_ADMIN_PASSWORD": secrets.token_urlsafe(24),
        "QUAL_USER_PASSWORD": secrets.token_urlsafe(24),
    }
    staging = target.with_suffix(".tmp")
    staging.write_text("".join(f"export {key}='{value}'\n" for key, value in values.items()))
    staging.chmod(0o400)
    os.chown(staging, int(os.environ["HOST_UID"]), int(os.environ["HOST_GID"]))
    staging.replace(target)


if __name__ == "__main__":
    main()
