---
title: "Designing beginner forensics challenges that teach investigation, not tricks"
date: 2026-12-01
type: blog
summary: "What I learned building network and disk forensics challenges for CSECcon, with two worked examples and the design rules I now follow."
tags: [ctf, forensics, dfir, teaching, csec]
draft: false
---

Forensics challenges can easily turn into a game of guessing what the author had in mind. When I started building challenges for CSECcon, UTS CSEC's annual conference, I set myself one rule: a beginner should finish knowing how an analyst thinks, not just a trick. Before building anything, I reached out to a DFIR professional at Canva for input on what beginner challenges should teach.

## The rule I design by

Every challenge has to mirror something a real analyst would see, and the solve has to use a skill they would use on the job. If the only way in is guessing, the challenge is broken.

## The challenge set

| Challenge | What the player does | Real-world parallel | Skill it builds |
| --- | --- | --- | --- |
| HTTP credential capture (PCAP) | Finds a login sent over plain HTTP | Credentials sniffed on a flat network | Summarising a capture first, then following streams |
| Zip with a leaked password (PCAP) | Pulls a zip out of the traffic, then finds its password elsewhere in the same capture | Data staged and moved, with the secret leaking through a separate channel | Correlating two events in one capture |
| DNS exfiltration | Rebuilds a base32 flag split across subdomain queries | DNS tunnelling past egress filtering | Spotting odd query volume and random-looking names |
| Git repository recovery | Finds a "deleted" commit with `git fsck` | Secrets committed, then "removed" from history | Knowing that deleted rarely means gone |
| File carving | Extracts a ZIP appended to a PNG | Data hidden inside an innocent-looking file | Trusting magic bytes, not extensions |

## Worked example 1: DNS exfiltration

The capture holds ordinary browsing plus a run of queries to one domain with long, random-looking subdomains. Each subdomain carries a chunk of the flag, base32-encoded so it only uses characters a DNS label allows.

The decode needs two fixes that real exfiltration analysis needs too. Resolvers retry, so some queries repeat and have to be de-duplicated. And DNS labels can't contain `=`, so the base32 padding is stripped before sending and has to be added back before decoding.

```bash
tshark -r dns.pcap -Y 'dns.flags.response == 0' -T fields -e dns.qry.name \
  | awk '!seen[$0]++' \
  | sed 's/\.exfil\.example\.com$//' \
  | tr -d '\n' | tr 'a-z' 'A-Z' > chunks.txt

# DNS labels can't carry '=' padding, so put it back before decoding
python3 -c "import base64; s=open('chunks.txt').read().strip(); print(base64.b32decode(s + '=' * (-len(s) % 8)).decode())"
```

On a test capture built the same way, with one retry duplicated on purpose, that prints:

```console
CSEC{dns_tunnels_leave_footprints}
```

There's a weakness worth pointing out to players. De-duplicating by value breaks if two chunks happen to be identical. Real tunnelling tools add a sequence number to each query for exactly this reason, and spotting that difference is a good conversation starter about how real tools are built.

## Worked example 2: the commit that wasn't deleted

The player gets a Git repository whose history looks clean. Someone committed a config file with a secret in it, noticed, and ran `git reset --hard` to make it go away.

```console
$ git fsck --lost-found
dangling commit 288436b6e451e09bd10d9400105b2a1e119475d3
$ git show 288436b6:.env
API_KEY=CSEC{dangling_commits_remember}
```

`git reset --hard` moves the branch pointer back, but the commit object stays in `.git/objects` until garbage collection prunes it. `git fsck` lists objects that nothing points to any more, and `git show` reads a file straight out of one of them. The lesson carries straight into real work: a secret that was ever committed, and especially one that was ever pushed, should be treated as leaked and rotated. Rewriting history doesn't un-leak it.

The third classic, a ZIP glued onto the end of a PNG, is walked through in my [CTF methodology post](/blog/ctf-methodology).

## Hints that teach

Hints work best as a ladder, where each rung gives a little more away:

1. **Where to look:** "Not all DNS traffic is browsing."
2. **What to measure:** "Compare subdomain lengths across domains."
3. **What to do:** "The alphabet is A to Z and 2 to 7."

A player who needs only the first hint still did the investigation. A player who needs all three still leaves knowing what base32 looks like and why an attacker would choose it.

## What building challenges taught me as a player

I now ask "what did the author want me to learn?" whenever I'm stuck, and it gets me unstuck more often than any tool does. Good challenges and good reports share a structure: evidence, reasoning, conclusion. And explaining a bug to a beginner turns out to be the same skill as explaining it to a developer. Both need the root cause in one sentence and a fix they can act on.
