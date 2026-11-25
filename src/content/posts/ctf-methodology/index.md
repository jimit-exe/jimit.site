---
title: "How I work a CTF challenge"
date: 2026-11-27
type: methodology
summary: "The loop I used to clear every flag in the Project Black graduate CTF: notes first, one timeboxed hypothesis at a time, and the fix written down before I move on."
tags: [ctf, methodology, web, forensics]
featured: true
draft: false
---

I cleared all nine flags in the Project Black graduate CTF, bonuses included, and every flag in the Vanguard Cyber CTF. I'm not the fastest player in the room and I definitely don't know every trick. What I do have is a loop I run the same way on every challenge, and it's the same loop I want running in my head when I'm looking at a client's application. So I'm writing it down.

## The loop

1. Read everything twice before touching anything. Title, description, points value, every attached file. I jot down every noun I see: file names, usernames, version numbers, anything oddly phrased. The title is often the biggest hint on the page.
2. Open a notes file first. If I can't explain afterwards how I got a flag, I didn't really learn anything. My template is below.
3. Triage. Work out what I'm actually looking at before picking a tool. A file extension, a banner or a header is only a claim until I've checked it.
4. Write down one hypothesis and give it a timebox, usually 20 minutes. "The session cookie is a JWT and the server trusts its `alg` header" is a hypothesis. "Try things in Burp" isn't.
5. Run the smallest test that proves or kills it. One request, one command. I log the result even when it fails, so I don't walk into the same dead end twice.
6. When the timebox runs out, change layer. If I've been staring at encoding, I move to the protocol. If I've been on the protocol, I look at the application logic. Then I ask what the author wanted me to learn. Building challenges for CSECcon made that question a lot more useful, because now I know how much thought goes into the intended path.
7. After the flag, write two lines: why it worked, and how a developer would fix it. A real report needs that second line, and it's the one most CTF notes skip.

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

If I could only keep one part of this, it'd be the Facts/Hypotheses split. Facts is only for things I've actually seen, like a response header, a file signature or an error message. Guesses go under Hypotheses. It sounds fussy, but it's what stops me building three steps on top of something I only assumed.

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

On Reactor, it went like this:

- Facts: port 3000 open, an `X-Powered-By: Next.js` response header, scripts loading from `/_next/static/chunks/`.
- Hypothesis: the framework itself is the way in. The smallest useful test is identifying the version, not fuzzing directories.
- Result: Next.js 15.0.3, which is affected by CVE-2025-55182, a pre-authentication remote code execution bug in React Server Components.
- Fix line: upgrade to a patched release.

The [full writeup](/writeups/htb-reactor) covers the rest of the chain.

### A forensics file that is really two files

An image that's far bigger on disk than its dimensions can explain is a classic forensics setup. I've since used it in challenges I built myself. With the loop, it doesn't take long:

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

`file` only reads the first few bytes, so it says PNG. The ZIP signature `PK\x03\x04` at byte 75 means someone glued a second file onto the end. `unzip` reads an archive from its end, finds the ZIP and grumbles about the 75 bytes of image in front of it. Outside a CTF, this is data hidden in an upload that looks harmless, and the fix is to check uploads by what's in them rather than what they're called.

## My setup

Kali Linux in UTM on my MacBook, with Burp Suite, Wireshark, CyberChef and the usual command-line tools. Nothing fancy. Honestly, the loop has helped me more than anything on that list.

## What carries over to real work

The notes file is basically a small incident report: what I saw, what I think it means, what I concluded. Timeboxing matters even more on a real test, where the client is paying for coverage and won't thank me for three hours down one rabbit hole. But the habit I most want to bring into application security work is the last one, writing the fix after every flag. Finding a bug feels great. The fix is what the client actually walks away with.
