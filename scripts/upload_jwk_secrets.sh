#!/bin/bash
aws secretsmanager create-secret \
  --name rems/visa/private-key.jwk \
  --secret-string file://../.secrets/private-key.jwk

aws secretsmanager create-secret \
  --name rems/visa/public-key.jwk \
  --secret-string file://../.secrets/public-key.jwk
