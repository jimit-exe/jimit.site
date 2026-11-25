---
title: "Network Traffic Analyzer: live packets in the browser, and the XSS hiding in them"
date: 2025-06-01
updated: 2026-12-03
type: project
summary: "A Scapy and Flask-SocketIO tool that streams live traffic to a browser dashboard, and why every packet field it shows has to be treated as attacker-controlled input."
tags: [python, scapy, flask-socketio, network-analysis, xss, appsec]
draft: false
---

I built the Network Traffic Analyzer to understand the wire formats I test against, by watching them live instead of reading static captures after the fact. It captures packets with Scapy, reduces each one to a compact record, and streams the records to a browser dashboard over WebSockets. I generate the traffic in my VMware attack and detection lab.

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

Watching traffic live builds intuition faster than reading a capture afterwards. During an ARP cache-poisoning test in my lab, the spike in ARP replies was obvious on the dashboard. In a static capture, the same pattern is something you have to go looking for.

## The bug class hiding in every packet

Every field on the dashboard comes from a packet, and anyone on the network can put almost anything in a packet. A DNS name is the easiest example. Feeding the summariser a crafted query shows the text arriving intact:

```console
$ python3 test_capture.py | grep DNS
{'time': 1795589570.8342686, 'len': 71, 'proto': 'DNS', 'src': '10.0.0.5', 'dst': '1.1.1.1', 'info': 'example.com.'}
{'time': 1795589570.835511, 'len': 98, 'proto': 'DNS', 'src': '10.0.0.66', 'dst': '1.1.1.1', 'info': '<img src=x onerror=alert(1)>.evil.test.'}
```

That's correct behaviour for the capture side: it should report exactly what was on the wire. The danger is on the browser side. If the dashboard builds rows with `innerHTML` or a template string, that DNS name becomes a live `<img>` tag and its `onerror` handler runs in the analyst's browser. The person watching for attacks becomes the target.

```javascript del={2-3}
// Unsafe: packet text becomes HTML
rows.insertAdjacentHTML("afterbegin",
  `<tr><td>${p.proto}</td><td>${p.src}</td><td>${p.dst}</td><td>${p.info}</td></tr>`);
```

The fix is to treat packet fields as text, always:

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

I checked both versions against the payload above in a headless DOM. The template-string version created an `<img>` element. The `textContent` version created none and displayed the payload as plain text.

To test a running dashboard in the lab, send the payload from another VM and watch what the browser does:

```python
# run as root on a lab VM; 10.0.0.1 is the lab's DNS server
from scapy.all import DNS, DNSQR, IP, UDP, send

send(IP(dst="10.0.0.1") / UDP(dport=53) /
     DNS(qd=DNSQR(qname="<img src=x onerror=alert(1)>.lab.test")))
```

## Other things the tool needs before anyone else runs it

- **Least privilege.** Packet capture needs raw-socket access; the web dashboard doesn't. Capture with the minimum privilege instead of running the whole app as root.
- **Exposure.** A dashboard on `0.0.0.0` with no login shows your network's traffic to anyone who can reach it. Bind it to `127.0.0.1`, as the code above does, or put authentication in front of it.
- **Scope.** Only capture on networks you own or are authorised to monitor.

## What it catches and what it misses

It's good at patterns you can see in headers alone: ARP floods and poisoning, DNS lookups, SYN-heavy connection patterns, chatty hosts. It sees nothing inside TLS beyond the endpoints and ports. The version above labels traffic by layer, not by application protocol, so HTTP shows up as TCP to port 80. And a Python callback plus one WebSocket message per packet won't keep up with a busy link. Filtering at capture time is what kept the dashboard responsive under the load I generated, which is why the BPF filter matters as much as any line of Python.

## What's next

Signature-based alerting for known attack patterns, and PCAP export so any interesting session can be replayed in Wireshark.

## What I learned

Real-time visibility builds intuition about protocol behaviour faster than static captures do, and filtering is what makes high-volume capture usable. The bigger lesson was the XSS: a defensive tool is still an application, and the data it watches is written by the people it's watching for.
