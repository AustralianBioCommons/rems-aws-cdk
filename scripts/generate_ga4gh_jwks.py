import os
import json
from jwcrypto import jwk

# Create the .secrets directory relative to script location
secrets_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.secrets"))
os.makedirs(secrets_dir, exist_ok=True)

# Generate a new ES256 key pair
key = jwk.JWK.generate(kty='RSA', size=2048)

# Export private key to a file
with open("../.secrets/private-key.jwk", "w") as f:
    f.write(key.export(private_key=True))

# Export public key to a file
public_key_json = key.export(private_key=False)
public_key_obj = jwk.JWK(**json.loads(public_key_json))

with open("../.secrets/public-key.jwk", "w") as f:
    f.write(public_key_obj.export())

