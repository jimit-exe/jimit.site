---
title: "How I work a CTF challenge"
date: 2026-11-27
type: methodology
summary: "The loop I used to clear every flag in the Project Black graduate CTF: notes first, one timeboxed hypothesis at a time, and the fix written down before I move on."
tags: [ctf, methodology, web, forensics]
featured: true
draft: false
---

In the Project Black graduate CTF I cleared all nine flags, bonuses included. In the Vanguard Cyber CTF I cleared every flag. I'm not the fastest player in the room and I don't know every trick. What gets me to the end is a loop I run the same way on every challenge. It's also the loop I want running in my head on a client's application, which is why I'm writing it down.

## The loop

1. **Read everything twice before touching anything.** The title, the description, the points value and every attached file. I write down each noun I see: file names, usernames, version numbers, odd phrasing. The title is often the biggest hint on the page.
2. **Open a notes file first.** If I can't explain afterwards how I got a flag, I didn't learn anything from it. My template is below.
3. **Triage.** Work out what I'm actually looking at before I pick a tool. A file extension, a banner or a header is a claim, not a fact, until I've checked it.
4. **Write one hypothesis and give it a timebox.** Usually 20 minutes. "The session cookie is a JWT and the server trusts its `alg` header" is a hypothesis. "Try things in Burp" is not.
5. **Run the smallest test that proves or kills it.** One request, one command. I log the result even when it fails, because a dead end I've written down is one I won't walk into twice.
6. **When the timebox runs out, change layer.** If I've been staring at encoding, I move to the protocol. If I've been on the protocol, I move to application logic. Then I ask what the author wanted me to learn. Building challenges for CSECcon made that question far more useful, because I now know how much thought goes into the intended path.
7. **After the flag, write two lines:** why it worked, and how a developer would fix it. The second line is the one a real report needs, and it's the one most CTF notes leave out.

## The notes file

```markdown
# <challenge> (<category>, <points> pts)
Given:
Goal:

## Facts (only things I have actually seen)
-

## Hypotheses (timeboxed)
- [ ] H1:  (20 min)

## Log
| Time | Action | Result |
|------|--------|--------|

## Flag and why it worked

## Real-world fix
```

The split between Facts and Hypotheses matters most. Facts only hold things I've seen myself: a response header, a file signature, an error message. Guesses go under Hypotheses. Keeping them apart stops me building three steps on top of something I only assumed.

## First five minutes by category

| Category | First moves | The trap I watch for |
| --- | --- | --- |
| Web | View source, `robots.txt`, response headers, cookies, every JavaScript file; all traffic through Burp | Fuzzing before reading the app's own code and comments |
| Forensics | `file`, `exiftool`, `strings`, `binwalk`, then the magic bytes | Trusting the file extension |
| Network (PCAP) | Wireshark's Protocol Hierarchy and Conversations views, then Follow Stream | Reading packets one by one instead of summarising first |
| Crypto | Identify the encoding or cipher, then check for key reuse and short keys | Writing a solver before checking for a known weakness |
| OSINT | Metadata, reverse image search, archived pages | Chasing a lead outside the challenge's scope |

For anything file-based, these five commands come first:

```bash
file challenge.bin                # what is it really?
exiftool challenge.bin            # metadata, authors, odd comments
strings -n 8 challenge.bin | less # readable text, flag formats, URLs
binwalk challenge.bin             # embedded files, e.g. a ZIP after a PNG
xxd challenge.bin | head -n 20    # magic bytes vs the extension
```

## The loop on two real problems

### A web foothold: Hack The Box's Reactor

Applied to Reactor, the loop looks like this:

- **Facts:** port 3000 open, an `X-Powered-By: Next.js` response header, scripts loading from `/_next/static/chunks/`.
- **Hypothesis:** the framework itself is the way in. The smallest useful test is identifying the version, not fuzzing directories.
- **Result:** Next.js 15.0.3, which is affected by CVE-2025-55182, a pre-authentication remote code execution bug in React Server Components.
- **Fix line:** upgrade to a patched release.

The [full writeup](/writeups/htb-reactor) covers the rest of the chain.

### A forensics file that is really two files

An image whose file size is far bigger than its dimensions can explain is a classic forensics pattern, and one I later used when building challenges. The loop keeps it short:

```console
$ file cat.png
cat.png: PNG image data, 8 x 8, 8-bit/color RGB, non-interlaced
$ grep -obUaP "PK\x03\x04" cat.png
75:PK
$ unzip cat.png
warning [cat.png]:  75 extra bytes at beginning or within zipfile
  (attempting to process anyway)
 extracting: flag.txt
```

`file` only reads the first few bytes, so it reports a PNG. The ZIP signature `PK\x03\x04` sitting at byte 75 says a second file has been glued onto the end. `unzip` reads an archive from its end, finds the ZIP, and complains about the 75 bytes of image in front of it. The real-world version is data hidden inside an innocent-looking upload, and the fix is to validate uploads by their content, not their name.

## My setup

Kali Linux in UTM on my MacBook, with Burp Suite, Wireshark, CyberChef and the standard command-line tools. Nothing exotic. The loop matters more than the toolbox.

## What carries over to real work

The notes habit is incident-report writing in miniature: evidence, reasoning, conclusion, in that order. Timeboxing is how a real test gets scoped, because a client pays for coverage, not for one rabbit hole. Writing the fix after every flag is the habit I most want to bring into application security work. Finding the bug is half the job. Explaining how to stop it coming back is the half the client keeps.
