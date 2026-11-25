---
title: "Network Traffic Analyzer: live packets in the browser, and the XSS hiding in them"
date: 2025-06-01
updated: 2026-12-03
type: project
summary: "A Scapy and Flask-SocketIO tool that streams live traffic to a browser dashboard, and why every packet field it shows has to be treated as attacker-controlled input."
tags: [python, scapy, flask-socketio, network-analysis, xss, appsec]
draft: false
---

I built the Network Traffic Analyzer because I wanted to see the protocols I test against while they're happening, not in a static capture afterwards. It captures packets with Scapy, boils each one down to a small record, and streams those records to a browser dashboard over WebSockets. The traffic comes from my VMware attack and detection lab.

## What it does

- Captures live traffic with Scapy, narrowed with BPF filters such as `tcp port 80 or arp`.
- Decodes ARP, IP, TCP, UDP, DNS and ICMP, and reduces each frame to a small record: protocol, source, destination and a one-line summary.
- Pushes each record to the browser over a Flask-SocketIO event, so the page updates without polling.
- Shows live per-protocol counters and a scrolling packet table.

## How it works

A trimmed-down version of the capture side:

```python title="capture.py"
from flask import Flask, render_template
from flask_socketio import SocketIO
from scapy.all import ARP, DNSQR, ICMP, IP, TCP, UDP, sniff

app = Flask(__name__)
socketio = SocketIO(app)


def summarise(pkt) -> dict:
    """Reduce one frame to a small record the browser can display."""
    record = {"time": float(pkt.time), "len": len(pkt),
              "proto": "OTHER", "src": "", "dst": "", "info": ""}

    if ARP in pkt:
        arp = pkt[ARP]
        op = "who-has" if arp.op == 1 else "is-at"
        record.update(proto="ARP", src=arp.psrc, dst=arp.pdst,
                      info=f"{op} {arp.hwsrc}")
    elif IP in pkt:
        record.update(src=pkt[IP].src, dst=pkt[IP].dst)
        if pkt.haslayer(DNSQR):
            name = pkt[DNSQR].qname.decode(errors="replace")
            record.update(proto="DNS", info=name)
        elif TCP in pkt:
            tcp = pkt[TCP]
            record.update(proto="TCP", info=f"{tcp.sport} -> {tcp.dport} [{tcp.flags}]")
        elif UDP in pkt:
            record.update(proto="UDP", info=f"{pkt[UDP].sport} -> {pkt[UDP].dport}")
        elif ICMP in pkt:
            record.update(proto="ICMP", info=f"type {pkt[ICMP].type}")
    return record


def capture(bpf: str) -> None:
    sniff(filter=bpf, store=False,
          prn=lambda pkt: socketio.emit("packet", summarise(pkt)))


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    socketio.start_background_task(capture, "tcp or udp or arp or icmp")
    # Loopback only: the dashboard shows other people's traffic metadata.
    socketio.run(app, host="127.0.0.1", port=5000)
```

Capture runs as a background task so the web server stays responsive, and `store=False` stops Scapy keeping every packet in memory during a long session.

## What the live view showed

During an ARP cache-poisoning test in my lab, the spike in ARP replies jumped straight out on the dashboard. In a static capture I'd have had to go looking for that same pattern. That's the main reason I like watching traffic live.

## The bug class hiding in every packet

Every field on the dashboard comes from a packet, and anyone on the network can put almost anything in a packet. DNS names are the easiest example. Feed the summariser a crafted query and the text comes through untouched:

```console
$ python3 test_capture.py | grep DNS
{'time': 1795589570.8342686, 'len': 71, 'proto': 'DNS', 'src': '10.0.0.5', 'dst': '1.1.1.1', 'info': 'example.com.'}
{'time': 1795589570.835511, 'len': 98, 'proto': 'DNS', 'src': '10.0.0.66', 'dst': '1.1.1.1', 'info': '<img src=x onerror=alert(1)>.evil.test.'}
```

That's what the capture side should do, since its job is to report exactly what was on the wire. The danger is in the browser. If the dashboard builds rows with `innerHTML` or a template string, that DNS name turns into a real `<img>` tag and its `onerror` handler runs in the analyst's browser. So the person watching for attacks is the one getting attacked.

```javascript del={2-3}
// Unsafe: packet text becomes HTML
rows.insertAdjacentHTML("afterbegin",
  `<tr><td>${p.proto}</td><td>${p.src}</td><td>${p.dst}</td><td>${p.info}</td></tr>`);
```

The fix is to always treat packet fields as text:

```javascript title="dashboard.js"
const socket = io();
const rows = document.querySelector("#packets tbody");

socket.on("packet", (p) => {
  const tr = document.createElement("tr");
  for (const value of [p.proto, p.src, p.dst, p.info]) {
    const td = document.createElement("td");
    td.textContent = value; // packet data is attacker-controlled: never innerHTML
    tr.appendChild(td);
  }
  rows.prepend(tr);
  if (rows.rows.length > 500) rows.deleteRow(-1); // keep the page light
});
```

I ran both versions against that payload in a headless DOM. The template-string version created an `<img>` element. The `textContent` version didn't, and just showed the payload as text.

To test a running dashboard in the lab, send the payload from another VM and watch what the browser does:

```python
# run as root on a lab VM; 10.0.0.1 is the lab's DNS server
from scapy.all import DNS, DNSQR, IP, UDP, send

send(IP(dst="10.0.0.1") / UDP(dport=53) /
     DNS(qd=DNSQR(qname="<img src=x onerror=alert(1)>.lab.test")))
```

## Other things the tool needs before anyone else runs it

- Packet capture needs raw-socket access, but the web dashboard doesn't. Give capture the least privilege it needs instead of running the whole app as root.
- A dashboard on `0.0.0.0` with no login shows your network's traffic to anyone who can reach it. Bind it to `127.0.0.1` like the code above does, or put authentication in front of it.
- Only capture on networks you own or are authorised to monitor.

## What it catches and what it misses

It's good at anything you can see from headers alone: ARP floods and poisoning, DNS lookups, SYN-heavy connection patterns, chatty hosts. Inside TLS it sees nothing beyond the endpoints and ports. The version above labels traffic by layer rather than application protocol, so HTTP just shows up as TCP to port 80. And a Python callback plus one WebSocket message per packet won't keep up with a busy link. Filtering at capture time is what kept the dashboard responsive under the load I generated, so honestly the BPF filter matters as much as any of the Python.

## What's next

Signature-based alerts for known attack patterns, and PCAP export so I can replay anything interesting in Wireshark.

## What I learned

Watching protocols live taught me more, and faster, than static captures did, and filtering is what made high-volume capture usable at all. The XSS was the bigger lesson, though. A defensive tool is still an application, and the data it watches is written by the people it's watching for.
