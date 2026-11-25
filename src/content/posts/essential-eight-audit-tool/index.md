---
title: "E8 Audit Tool — Automated Essential Eight Assessment"
date: 2026-02-01
type: project
summary: "Built a Flask platform that automates Essential Eight maturity assessment across four ASD controls and correlates findings against 200,000+ live CVE records."
tags: [compliance, web-app, nvd-api]
featured: true
draft: false
---

## Executive Summary

**Scenario.** Essential Eight maturity assessments at small orgs are often run from manual spreadsheets — slow, inconsistent, and disconnected from live vulnerability data.

**Impact.** A Flask web app that automates assessment across four ASD-mandated controls, maps results to ACSC Maturity Levels 1–3, and correlates patch status against the NIST NVD's 200,000+ CVE records.

**Action.** Designed the control checks and scoring model, integrated the NVD API for live CVE correlation, and rendered stakeholder dashboards with Chart.js.

## 1. Context & Goals

The Australian Essential Eight is the baseline most local organisations are measured against,
yet the assessment itself is frequently a manual, spreadsheet-driven exercise. I built the E8
Audit Tool to automate that process and, crucially, to tie a static compliance checklist to
**live vulnerability intelligence** — answering not just "are we patched?" but "what are we
exposed to right now?"

## 2. Tools & Environment

- **Backend:** Python + Flask
- **Vulnerability data:** NIST NVD API (200,000+ CVE records)
- **Visualisation:** Chart.js dashboards for non-technical stakeholders
- **Mapping:** ACSC Essential Eight Maturity Levels 1–3
- **Controls assessed:** patch management, macro hardening, admin-privilege auditing, backup status

## 3. The Investigation

The platform runs each control as an independent check that returns a maturity score, then
aggregates them into an overall posture. The most valuable piece is the patch-management
check, which queries the NVD for CVEs affecting declared software and weights the result by
severity:

```python
import httpx

NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0"

def cves_for(product: str, version: str) -> list[dict]:
    cpe = f"cpe:2.3:a:*:{product}:{version}:*:*:*:*:*:*:*"
    r = httpx.get(NVD, params={"cpeName": cpe}, timeout=30)
    r.raise_for_status()
    return r.json().get("vulnerabilities", [])
```

Each control maps to a maturity level using an explicit rubric so results are repeatable and
defensible:

```python
def maturity(level_signals: dict) -> int:
    if level_signals["ml3"]:
        return 3
    if level_signals["ml2"]:
        return 2
    return 1 if level_signals["ml1"] else 0
```

Results feed Chart.js dashboards so a manager sees posture at a glance while an engineer can
drill into the specific CVEs driving a low patch score.

## 4. Findings & Recommendations

- **Automation removes drift.** Codifying the rubric eliminated the inconsistency of manual
  spreadsheet scoring between assessors.
- **Live correlation adds urgency.** Linking patch status to current CVEs reframed compliance
  as active risk rather than a checkbox.
- **Recommendations for adopters:** cache NVD responses to respect rate limits, and schedule
  re-assessment so the posture reflects newly disclosed vulnerabilities.

## 5. Skills Demonstrated

- **Compliance frameworks** — practical command of the ASD Essential Eight and ACSC maturity model.
- **API integration** — consumed and normalised large-scale CVE data from the NIST NVD.
- **Full-stack delivery** — Flask backend through to stakeholder-facing dashboards.
- **Risk communication** — translated technical findings into views non-technical owners can act on.
