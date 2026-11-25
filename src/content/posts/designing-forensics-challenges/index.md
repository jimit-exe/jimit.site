---
title: "Designing beginner forensics challenges that teach investigation, not tricks"
date: 2026-12-01
type: blog
summary: "What I learned building network and disk forensics challenges for CSECcon, with two worked examples and the design rules I now follow."
tags: [ctf, forensics, dfir, teaching, csec]
draft: false
---

Forensics challenges can easily turn into a game of guess-what-the-author-was-thinking. When I started building challenges for CSECcon, UTS CSEC's annual conference, I gave myself one rule: a beginner should come out knowing a bit about how an analyst thinks. A clever trick on its own doesn't count. Before I built anything, I reached out to a DFIR professional at Canva and asked what they thought beginner challenges should teach.

## The rule I design by

Each challenge should look like something a real analyst might actually run into, and solving it should use a skill they'd use at work. If the only way in is guessing, I've built it wrong.

## The challenge set

| Challenge | What the player does | Real-world parallel | Skill it builds |
| --- | --- | --- | --- |
| HTTP credential capture (PCAP) | Finds a login sent over plain HTTP | Credentials sniffed on a flat network | Summarising a capture first, then following streams |
| Zip with a leaked password (PCAP) | Pulls a zip out of the traffic, then finds its password elsewhere in the same capture | Data staged and moved, with the secret leaking through a separate channel | Correlating two events in one capture |
| DNS exfiltration | Rebuilds a base32 flag split across subdomain queries | DNS tunnelling past egress filtering | Spotting odd query volume and random-looking names |
| Git repository recovery | Finds a "deleted" commit with `git fsck` | Secrets committed, then "removed" from history | Knowing that deleted rarely means gone |
| File carving | Extracts a ZIP appended to a PNG | Data hidden inside an innocent-looking file | Trusting magic bytes, not extensions |

## Worked example 1: DNS exfiltration

The capture is mostly ordinary browsing, plus a run of queries to one domain with long, random-looking subdomains. Each subdomain carries a chunk of the flag, base32-encoded so it only uses characters allowed in a DNS label.

Decoding it needs two fixes you'd need on real exfiltration traffic too. Resolvers retry, so some queries show up twice and need de-duplicating. And DNS labels can't contain `=`, so the base32 padding gets stripped before sending and has to go back on before decoding.

```bash
tshark -r dns.pcap -Y 'dns.flags.response == 0' -T fields -e dns.qry.name \
  | awk '!seen[$0]++' \
  | sed 's/\.exfil\.example\.com$//' \
  | tr -d '\n' | tr 'a-z' 'A-Z' > chunks.txt

# DNS labels can't carry '=' padding, so put it back before decoding
python3 -c "import base64; s=open('chunks.txt').read().strip(); print(base64.b32decode(s + '=' * (-len(s) % 8)).decode())"
```

On a test capture built the same way, with one retry duplicated on purpose, that gives:

```console
CSEC{dns_tunnels_leave_footprints}
```

There's a catch I like pointing out to players: de-duplicating by value breaks if two chunks happen to be identical. Real tunnelling tools put a sequence number in each query for exactly this reason, and that usually gets people talking about how real tools are built.

## Worked example 2: the commit that wasn't deleted

The player gets a Git repository with a clean-looking history. Someone committed a config file with a secret in it, noticed, and ran `git reset --hard` to make it go away.

```console
$ git fsck --lost-found
dangling commit 288436b6e451e09bd10d9400105b2a1e119475d3
$ git show 288436b6:.env
API_KEY=CSEC{dangling_commits_remember}
```

`git reset --hard` moves the branch pointer back, but the commit object stays in `.git/objects` until garbage collection prunes it. `git fsck` lists objects that nothing points to any more, and `git show` reads a file straight out of one of them. This one applies directly to real work. If a secret was ever committed, and especially if it was ever pushed, treat it as leaked and rotate it. Rewriting history doesn't un-leak it.

The other classic, a ZIP glued onto the end of a PNG, is in my [CTF methodology post](/blog/ctf-methodology).

## Hints that teach

I write hints as a ladder, where each rung gives away a bit more:

1. Where to look: "Not all DNS traffic is browsing."
2. What to measure: "Compare subdomain lengths across domains."
3. What to do: "The alphabet is A to Z and 2 to 7."

Someone who only needs the first hint still did the investigation themselves. Someone who needs all three at least leaves knowing what base32 looks like and why an attacker would pick it.

## What building challenges taught me as a player

Whenever I'm stuck now, I ask what the author wanted me to learn, and that gets me unstuck more often than any tool. The other surprise was how much challenge design has in common with report writing. Explaining a bug to a beginner is pretty much the same job as explaining it to a developer: both want the root cause in a sentence and a fix they can actually do something with.
