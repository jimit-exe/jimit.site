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

Reactor's foothold is a CVSS 10.0 bug in a framework that real companies ship every day. Every step after that is a configuration mistake I could imagine finding on a client engagement: passwords stored as unsalted MD5, the same password reused for SSH, and a debugger left switched on in a root process. So alongside the walkthrough, this writeup ends the way a report would: findings, fixes, and how a defender would have caught each step.

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

The scan showed SSH on port 22 and a web application on port 3000. The response headers and page source gave the framework away:

```bash
curl -sI http://$TARGET:3000/ | grep -i x-powered-by
```

```console
X-Powered-By: Next.js
```

Scripts loaded from `/_next/static/chunks/`, the layout of a Next.js App Router build. The application was Next.js 15.0.3, a version in the range affected by React2Shell. That changed the plan: instead of fuzzing for hidden pages, the first thing to test was the framework itself.

## Foothold: CVE-2025-55182 (React2Shell)

React Server Components move data between server and browser using the Flight protocol. In vulnerable versions, the server deserialises attacker-supplied Flight data unsafely, and a crafted `__proto__` reference turns into code execution. No login is needed and one HTTP request is enough. It was disclosed on 3 December 2025 and rated CVSS 10.0 ([Hack The Box threat spotlight](https://www.hackthebox.com/blog/react2shell-cve-2025-55182-threat-spotlight)).

I used a public proof of concept rather than writing my own exploit. This writeup is about the chain and the fixes, so the payload isn't reproduced here. It landed a shell as the `node` user inside the application directory:

```console
node@reactor:/opt/reactor-app$ ls
app  next.config.js  node_modules  package.json  package-lock.json  reactor.db
```

## Credentials from the application database

A SQLite database sitting next to the code is always worth a look:

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

The table held two accounts, `admin` and `engineer`. Each `password_hash` was 32 hexadecimal characters with no salt stored anywhere: raw MD5.

```bash
hashcat -m 0 engineer.hash /usr/share/wordlists/rockyou.txt
```

Mode `0` is hashcat's mode for raw MD5. The `engineer` hash fell to the rockyou wordlist. The cracked password also worked for SSH as `engineer`, which turned a web application bug into an interactive login on the host.

## Privilege escalation: a debugger left open on a root process

As `engineer`, the listening sockets and the process list told the rest of the story:

```console
engineer@reactor:~$ ss -tlnp
engineer@reactor:~$ ps aux | grep -i node
root   1407 ... /usr/bin/node --inspect=127.0.0.1:9229 /opt/uptime-monitor/worker.js
```

Port 9229 is Node's default inspector port. `--inspect` exposes a debugging interface that will evaluate any JavaScript inside the running process. This process runs as root, so anyone who can reach the port can run code as root. Binding it to 127.0.0.1 stops nobody who already has a local shell, and I had one.

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

A plain `require` isn't in scope when the debugger evaluates an expression in the global context, which is why the call goes through `process.mainModule.require`. From there, root access was one more command.

## What the client report would say

| Finding | Severity | Fix |
| --- | --- | --- |
| Unpatched Next.js / React Server Components (CVE-2025-55182) | Critical | Upgrade to the patched release for the branch in use (16.0.7 or later on 16.x; the official advisory lists the fixed release for each 15.x line). WAF rules are a stopgap only |
| Passwords stored as unsalted MD5 | High | Hash passwords with Argon2id or bcrypt, which salt each password and are slow to brute-force |
| Application password reused for the system account | High | Unique credentials per system; SSH keys only, with password login disabled |
| Node inspector enabled on a root process | High | Never ship `--inspect` to production. Run services as unprivileged users |

## How a defender catches each step

> [!DEFENDER]
> None of these steps is quiet if someone is watching the right logs.

- **The exploit attempt:** POST requests carrying `next-action` or `rsc-action-id` headers that don't match the app's real server actions, or request bodies containing `__proto__` ([Hack The Box threat spotlight](https://www.hackthebox.com/blog/react2shell-cve-2025-55182-threat-spotlight)).
- **Code execution:** a Node process spawning `sh`, `id` or `whoami`. A web application server rarely runs other programs, so logging every program the service account starts is low-noise:

```bash
# /etc/audit/rules.d/webapp.rules
# 1001 = the app's service account UID; adjust for your host
-a always,exit -F arch=b64 -S execve -F euid=1001 -k webapp_exec
```

Review hits with `ausearch -k webapp_exec`.

- **The open debugger:** a hardening check that runs `ps -eo user,args | grep -- '--inspect'` should return nothing on a production host.
- **The SSH login:** a first-ever interactive login for an account that normally only runs a service is worth an alert on its own.

## What I took from it

Fingerprint the framework before fuzzing anything. Version numbers are cheap to find, and a known bug in the framework beats any number of hidden directories.

Credentials in an application database are rarely only application credentials. Once the same password opens the host, a web bug becomes a host compromise.

Debug features are remote code execution waiting for a local user. `--inspect`, Flask's debug mode and exposed Java debug ports all have the same shape, and they're worth a dedicated line in every review checklist.
