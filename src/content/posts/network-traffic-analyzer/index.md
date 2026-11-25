---
title: "Network Traffic Analyzer — Offensive Tooling in Python"
date: 2025-06-01
type: project
summary: "Built a real-time packet capture and protocol-analysis tool in Python to inspect traffic across 10+ protocols and support network-layer threat detection."
tags: [security-tooling, python, network-analysis]
featured: true
draft: false
---

## Executive Summary

**Scenario.** Off-the-shelf packet tools are powerful but opaque to non-specialists; I wanted to deeply understand the wire formats I test against by building capture and decoding myself.

**Impact.** A self-built analyzer that performs live capture with BPF filtering and decodes 10+ protocols, exposing per-protocol statistics and packet detail through a real-time web UI.

**Action.** Implemented the capture engine with Scapy, streamed results over WebSockets, and used it to study attack traffic generated in my detection lab.

## 1. Context & Goals

Reading about TCP/IP is not the same as watching a SYN flood fill a capture buffer in real
time. I built this analyzer to close that gap: a tool that captures live traffic, decodes it
down to the protocol fields that matter for offensive and detection work, and presents it in
a way I could reason about quickly during lab exercises.

The goal was twofold — sharpen my protocol-level understanding, and produce reusable
**security tooling** that demonstrates I can build, not just operate, the instruments of the
trade.

## 2. Tools & Environment

- **Language:** Python 3
- **Capture & decoding:** Scapy with BPF filter support
- **Backend / streaming:** Flask + Flask-SocketIO (WebSockets)
- **Front end:** JavaScript UI with per-protocol statistics and packet inspection
- **Test traffic:** Generated inside my VMware attack/detection lab

## 3. The Investigation

The core loop captures packets and dispatches each to a protocol-aware handler. A BPF filter
lets me narrow the firehose to exactly what I'm studying — for example `tcp port 80 or arp`:

```python
from scapy.all import sniff

PROTO_HANDLERS = {}  # registry: layer name -> decoder

def handle(pkt):
    summary = {"len": len(pkt), "layers": []}
    for layer in ("Ether", "ARP", "IP", "TCP", "UDP", "DNS", "ICMP"):
        if pkt.haslayer(layer):
            summary["layers"].append(layer)
    socketio.emit("packet", summary)  # push to the live UI

sniff(filter="tcp or udp or arp or icmp", prn=handle, store=False)
```

Each captured frame is reduced to a compact record and pushed over a WebSocket so the UI
updates without polling. Per-protocol counters (`TCP`, `UDP`, `DNS`, `HTTP`, `ICMP`, `ARP`)
update live, which made anomalies — like a spike in `ARP` replies during a cache-poisoning
test — visually obvious.

## 4. Findings & Recommendations

This was a build project rather than a client engagement, so the "findings" are about tool
design and what it revealed:

- **Real-time visibility changes intuition.** Watching protocol ratios shift during an attack
  made detection signatures concrete in a way static captures did not.
- **Filtering is a force multiplier.** BPF support kept the capture relevant and the UI
  responsive even under generated load.
- **Next steps:** add signature-based alerting and export to PCAP so captures can be replayed
  in Wireshark for deeper forensic analysis.

## 5. Skills Demonstrated

- **Security tooling development** — designed and shipped a capture/analysis tool end-to-end.
- **Protocol-level networking** — hands-on decoding across the stack (Ethernet → application).
- **Python engineering** — Scapy, async streaming, clean handler architecture.
- **Detection mindset** — built the instrument I used to study attack traffic in my lab.
