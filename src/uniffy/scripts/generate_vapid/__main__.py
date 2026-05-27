"""Generate a VAPID keypair and print to stdout."""

import base64

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)


def main() -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())

    priv_numbers = private_key.private_numbers()
    priv_bytes = priv_numbers.private_value.to_bytes(32, byteorder="big")
    priv_b64 = base64.urlsafe_b64encode(priv_bytes).rstrip(b"=").decode("ascii")

    pub_bytes = private_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("ascii")

    pem = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()

    print("VAPID Keypair Generated\n")
    print(f"Private key (base64url): {priv_b64}")
    print(f"Public key  (base64url): {pub_b64}")
    print(f"\nPEM private key (for reference):\n{pem}")


if __name__ == "__main__":
    main()
