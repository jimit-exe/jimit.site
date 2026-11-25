---
title: "HTB Reactor: Next.js RCE to root through the Node inspector"
date: 2026-11-28
type: writeup
summary: "React2Shell for a foothold, unsalted MD5 in the app's database, then a root Node process with its debugger left open. Plus the fixes and how a defender catches each step."
tags: [htb, web, nextjs, nodejs, privesc, detection]
platform: Hack The Box
featured: true
draft: false
---

Reactor's foothold is a CVSS 10.0 bug in a framework plenty of real companies ship. Everything after that is a configuration mistake I could easily imagine finding on a client engagement: unsalted MD5 passwords, the same password reused for SSH, and a debugger left switched on in a root process. So after the walkthrough I've written it up the way I would in a report, with the findings, the fixes and how a defender could have caught each step.

> [!NOTE]
> Hack The Box only allows public writeups of retired machines. Flags, hashes and passwords are left out of this post.

## The chain at a glance

1. Port 3000 serves a Next.js 15.0.3 application.
2. CVE-2025-55182 (React2Shell) gives unauthenticated code execution as the `node` user.
3. The app's SQLite database, `reactor.db`, stores passwords as unsalted MD5.
4. The `engineer` hash cracks with a common wordlist, and the same password works over SSH.
5. A root-owned Node process runs with `--inspect` on 127.0.0.1:9229. Attaching a debugger to it runs code as root.

## Enumeration

Commands below use `$TARGET` for the machine's IP address.

```bash
nmap -sC -sV -oN reactor.nmap $TARGET
```

SSH on port 22 and a web app on port 3000. The response headers and page source gave the framework away pretty quickly:

```bash
curl -sI http://$TARGET:3000/ | grep -i x-powered-by
```

```console
X-Powered-By: Next.js
```

Scripts were loading from `/_next/static/chunks/`, which is how a Next.js App Router build is laid out. The app turned out to be Next.js 15.0.3, inside the range affected by React2Shell. That changed my plan. Instead of fuzzing for hidden pages, I went after the framework first.

## Foothold: CVE-2025-55182 (React2Shell)

React Server Components pass data between server and browser using the Flight protocol. In vulnerable versions the server deserialises Flight data from the client unsafely, and a crafted `__proto__` reference ends up as code execution. You don't need to log in, and one HTTP request does it. It was disclosed on 3 December 2025 and rated CVSS 10.0 ([Hack The Box threat spotlight](https://www.hackthebox.com/blog/react2shell-cve-2025-55182-threat-spotlight)).

I used a public proof of concept rather than writing my own. I care more about the chain and the fixes here, so I haven't reproduced the payload. It gave me a shell as the `node` user, sitting in the application directory:

```console
node@reactor:/opt/reactor-app$ ls
app  next.config.js  node_modules  package.json  package-lock.json  reactor.db
```

## Credentials from the application database

A SQLite file sitting right next to the code? Always worth a look:

```console
node@reactor:/opt/reactor-app$ sqlite3 reactor.db '.schema users'
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT
);
```

Two accounts, `admin` and `engineer`. Each `password_hash` was 32 hex characters with no salt stored anywhere, so raw MD5.

```bash
hashcat -m 0 engineer.hash /usr/share/wordlists/rockyou.txt
```

Mode `0` is hashcat's raw MD5 mode. The `engineer` hash fell to rockyou, and the same password worked for SSH as `engineer`. So a bug in the web app had just become an interactive login on the host.

## Privilege escalation: a debugger left open on a root process

Logged in as `engineer`, I checked the listening sockets and the process list:

```console
engineer@reactor:~$ ss -tlnp
engineer@reactor:~$ ps aux | grep -i node
root   1407 ... /usr/bin/node --inspect=127.0.0.1:9229 /opt/uptime-monitor/worker.js
```

9229 is Node's default inspector port. `--inspect` opens a debugging interface that will run any JavaScript you hand it inside the process. This process was running as root, so anyone who could reach that port could run code as root. Binding it to 127.0.0.1 doesn't help much against someone who already has a local shell, and I had one.

I forwarded the port over SSH and attached Node's built-in debugger client:

```bash
# on my machine: forward the inspector port over SSH
ssh -L 9229:127.0.0.1:9229 engineer@$TARGET
```

```console
$ node inspect 127.0.0.1:9229
debug> exec process.mainModule.require('child_process').execSync('id').toString()
'uid=0(root) gid=0(root) groups=0(root)\n'
```

The call goes through `process.mainModule.require` because a plain `require` isn't in scope when the debugger evaluates something in the global context. After that, a root shell was one more command away.

## What the client report would say

| Finding | Severity | Fix |
| --- | --- | --- |
| Unpatched Next.js / React Server Components (CVE-2025-55182) | Critical | Upgrade to the patched release for the branch in use (16.0.7 or later on 16.x; the official advisory lists the fixed release for each 15.x line). WAF rules are a stopgap only |
| Passwords stored as unsalted MD5 | High | Hash passwords with Argon2id or bcrypt, which salt each password and are slow to brute-force |
| Application password reused for the system account | High | Unique credentials per system; SSH keys only, with password login disabled |
| Node inspector enabled on a root process | High | Never ship `--inspect` to production. Run services as unprivileged users |

## How a defender catches each step

> [!DEFENDER]
> Every step here is noisy if someone is watching the right logs.

- Exploit attempts show up as POST requests with `next-action` or `rsc-action-id` headers that don't match any of the app's real server actions, or with `__proto__` in the body ([Hack The Box threat spotlight](https://www.hackthebox.com/blog/react2shell-cve-2025-55182-threat-spotlight)).
- Code execution looks like a Node process spawning `sh`, `id` or `whoami`. A web app server rarely starts other programs, so logging everything the service account runs doesn't add much noise:

```bash
# /etc/audit/rules.d/webapp.rules
# 1001 = the app's service account UID; adjust for your host
-a always,exit -F arch=b64 -S execve -F euid=1001 -k webapp_exec
```

Review hits with `ausearch -k webapp_exec`.

- The open debugger is easy to catch before anyone abuses it. `ps -eo user,args | grep -- '--inspect'` should return nothing on a production host, which makes it a cheap line in any hardening check.
- The SSH login was the first interactive login ever for an account that normally just runs a service. That's worth an alert by itself.

## What I took from it

Fingerprint the framework before you fuzz anything. Finding a version number takes a minute, and a known bug in the framework will get you further than any number of hidden directories.

Credentials in an application database are rarely just application credentials. The moment that password opened SSH, a web bug turned into a host compromise.

And debug features deserve their own line in every review checklist. `--inspect`, Flask's debug mode and exposed Java debug ports all have the same problem: give a local user access to one and they can run code as whoever owns the process.
