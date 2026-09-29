# Mintx — Project Context

> **Purpose of this file:** This is a shared knowledge file for AI assistants.
> The developer (Preetam) switches between multiple AI models across different platforms.
> Every model should **read this file first** and **update it** after making meaningful changes.

---

## 🔄 Model Handoff Log

| Timestamp (IST)        | Model / Platform                     | Summary of Work Done |
|-------------------------|--------------------------------------|----------------------|
| 2026-09-26 17:06        | Claude Opus 4.6 (Antigravity IDE)    | Initial project setup. Created this context file. |
| 2026-09-26 17:09        | Claude Opus 4.6 (Antigravity IDE)    | Filled in full project requirements, architecture, tech stack, and evaluation criteria from the problem statement. |
| 2026-09-26 17:35        | Claude Opus 4.6 (Antigravity IDE)    | Added 4 data contracts (SanitizedContext, ActionPlan, TokenMap, ActionResult) from Claude Sonnet 5 session. |
| 2026-09-26 18:02        | Claude Opus 4.6 (Antigravity IDE)    | Scaffolded full extension + server. All core modules implemented. esbuild bundler, first successful build. |
| 2026-09-29 09:49        | Claude Opus 4.6 (Antigravity IDE)    | Phase 2: Added screenshot capture, visual redaction engine (blackout/blur/pixelate/mask), vision model (Transformers.js vit-gpt2 + DETR), NER-based PII detector (bert-base-NER), PII region mapping for screenshot redaction. Updated service worker + content script. Build passing. |
| 2026-09-29 09:59        | Claude Opus 4.6 (Antigravity IDE)    | Phase 3: VLM planner (dual-mode: text-only LLM + multimodal VLM with redacted screenshots). Separate VLM_MODEL/VLM_BASE_URL config. dotenv loading. /config endpoint. Test shipping form page. |

---

## 📌 Project Overview

- **Project Name:** Mintx
- **Status:** 🟢 Phase 3 server VLM integration complete — ready for e2e testing
- **Type:** Privacy-preserving vision agent running in the browser (hackathon / SIH project)
- **Repository:** Local — `c:\Users\Preetam U\OneDrive\Desktop\Mintx`

### One-line Summary

A browser extension that uses a local vision model to understand screen state, sanitizes all sensitive/PII data client-side, sends only anonymized context to a server-side LLM/VLM for reasoning, receives an action plan back, and executes it in the browser — **nothing sensitive ever crosses the wire.**

---

## 🎯 Problem Statement (SIH)

Build a **privacy-preserving vision agent** that runs in the browser:

### Client-side (Browser Extension — Chrome/Firefox):
1. **Local Vision Processing** — Run a ViT or equivalent CV model in-browser (via WebGPU / WASM) that evaluates the current screen state.
2. **Privacy-Preserving Filter** — Sanitize sensitive/personal visual data before any network request:
   - Bounding-box redaction
   - Semantic obfuscation
   - Masking (blur faces, black out passwords, mask PII)
   - Use DOM tags or other methods for dynamic detection

### Server-side:
1. **Server-side LLM/VLM Integration** — Receives anonymized visual context, interprets it, returns either:
   - Processed data for client ingestion, OR
   - UI actions (e.g., "click the submit button", "scroll down") for the local client to execute
2. **Open-source/open-weights models only** (can use cloud-hosted versions during SIH demo)
3. Must demonstrate an **end-to-end task** assisting the user

---

## 📊 Evaluation Metrics

| Metric | Weight | Notes |
|--------|--------|-------|
| Accuracy of visual context from screen | 25% | How well the vision model understands the page |
| Recall & Precision for PII detection | 20% | Can it find all sensitive data? False positives? |
| Precision of redaction | 20% | Is the redaction thorough and correctly applied? |
| Client-side resource utilization | 20% | CPU/GPU/memory footprint in the browser |
| End-to-end latency | 15% | Total time from user request to task completion |

---

## 🏗️ Architecture

### High-Level Loop (Outer)

```
User Request
      │
      ▼
┌──────────────────────┐    sanitized context    ┌──────────────┐
│  Local Browser Agent │ ──────────────────────► │  Server AI   │
│  (Vision, DOM, PII   │                         │  (LLM        │
│   filtering)         │ ◄────────────────────── │   reasoning) │
└──────────────────────┘         plan             └──────────────┘
      │
      ▼
  Browser Actions
  (click, type, verify)
      │
      └──── re-observe ──► (loop back to Local Browser Agent)
```

**Flow:** User request → local agent filters via vision/DOM/PII → sanitized context sent to server → server reasons and returns plan → local agent executes actions → re-observes → loop.

### Internal Agent Split

```
┌─────────────────────────────────────────────────┐
│                Local Browser Agent              │
│                                                 │
│  ┌──────────────────┐   ┌────────────────────┐  │
│  │   PERCEPTION     │   │   ACTION LAYER     │  │
│  │                  │   │                    │  │
│  │  • Vision Model  │──►│  • Data Vault      │  │
│  │  • DOM Extraction│ctx│  • Safety Rules    │  │
│  │  • PII Detection │   │  • Executor        │  │
│  └──────────────────┘   └────────┬───────────┘  │
│                                  │              │
└──────────────────────────────────┼──────────────┘
                                   ▼
                              Browser Page
```

### Key Design Principles

1. **Perception NEVER talks to the server directly.** Vision, DOM extraction, and PII detection all feed into sanitized context first — that's the boundary guaranteeing no raw PII leaves the device.
2. **Data Vault lives in the Action Layer, NOT Perception.** It resolves placeholders like `[NAME_001]` → real value right before the executor types it in. Real data never goes upstream.
3. **Safety Rules sit between the incoming plan and the Executor** — veto point for high-risk actions before anything fires.

---

## 📜 Data Contracts

### 1. SanitizedContext (client → server)

What the server **ever** sees. No raw PII.

```json
{
  "request_id": "req_8f2a1c",
  "timestamp": "2026-09-26T10:15:00Z",
  "user_intent": "fill out this shipping form",
  "page_domain": "example-shop.com",
  "dom_elements": [
    {
      "element_id": "el_12",
      "tag": "input",
      "type": "text",
      "role": "textbox",
      "label": "Full name",
      "placeholder": "John Doe",
      "current_value_token": null
    },
    {
      "element_id": "el_13",
      "tag": "input",
      "type": "email",
      "label": "Email address",
      "current_value_token": "[EMAIL_001]"
    }
  ],
  "vision_summary": "Two-column checkout form with a name field, email field, and a continue button below",
  "available_tokens": ["NAME_001", "EMAIL_001", "PHONE_001"],
  "action_history": [
    { "action_id": "act_1", "type": "click", "target": "el_04", "result": "success" }
  ]
}
```

- `current_value_token` — if a field is already filled, the server sees the token, never the value.
- `available_tokens` tells the server what data it can reference without exposing the data itself.
- `vision_summary` is text from the vision model, already PII-filtered before it lands here.
- `action_history` is short-term memory so the server doesn't repeat itself.

### 2. ActionPlan (server → client)

```json
{
  "request_id": "req_8f2a1c",
  "reasoning": "Fill name and email, then click continue",
  "actions": [
    {
      "action_id": "act_5",
      "type": "type",
      "target_element_id": "el_12",
      "value": "[NAME_001]",
      "risk_tier": "low"
    },
    {
      "action_id": "act_6",
      "type": "type",
      "target_element_id": "el_13",
      "value": "[EMAIL_001]",
      "risk_tier": "low"
    },
    {
      "action_id": "act_7",
      "type": "click",
      "target_element_id": "el_20",
      "value": null,
      "risk_tier": "medium"
    }
  ],
  "task_complete": false
}
```

- `value` is either a literal or a token reference like `[NAME_001]` — never a real value.
- `risk_tier` is a server suggestion; local safety layer has final say and can override **upward** only (never downward).
- `task_complete: false` tells the agent to keep looping.

### 3. TokenMap (local only — NEVER serialized outbound)

```json
{
  "NAME_001": "Rahul Sharma",
  "EMAIL_001": "rahul.sharma@example.com",
  "PHONE_001": "9876543210"
}
```

**Hard rule:** Nothing that touches the network layer should ever be able to import this module. Enforce at code-boundary level (separate module, separate build target, or at minimum a lint rule) — not just by convention.

### 4. ActionResult (executor → observe loop)

```json
{
  "action_id": "act_5",
  "status": "success",
  "dom_changed": true,
  "error": null
}
```

Feeds the "did it work → next task or retry" branch in the observe-act-observe loop.

---

## 🛠️ Tech Stack (Planned)

### Client-side (Browser Extension)
| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Extension framework | Chrome Extension (Manifest V3) + Firefox WebExtension | Required by problem statement |
| Vision model runtime | ONNX Runtime Web / Transformers.js | In-browser inference via WebGPU/WASM |
| Vision model | TBD — likely a lightweight ViT (e.g., MobileViT, DeiT-tiny) | Must fit in browser resource constraints |
| PII detection (text) | Regex + NER model (e.g., small BERT-NER via Transformers.js) | Detect names, emails, phones, SSNs, etc. |
| PII detection (visual) | Face detection model (e.g., BlazeFace via TF.js or ONNX) | Blur faces in screenshots |
| DOM extraction | Native DOM APIs | Parse page structure, form fields, labels |
| Redaction engine | Canvas API / OffscreenCanvas | Blur, blackout, mask regions on screenshots |
| Communication | WebSocket or fetch to server | Send sanitized context, receive plans |

### Server-side
| Component | Technology | Rationale |
|-----------|-----------|-----------|
| API server | Python (FastAPI) | Lightweight, async, easy to deploy |
| LLM/VLM | Open-source model — options: LLaVA, Qwen-VL, InternVL, Phi-3-Vision | Must be open-weights; cloud-hosted OK for demo |
| Action planner | Prompt-engineered pipeline on the VLM | Interpret sanitized screen + return structured actions |

---

## 📂 File Structure (Actual)

```
Mintx/
├── PROJECT_CONTEXT.md          ← this file (shared AI context)
├── codex.md                    ← companion notes from Codex sessions
├── extension/                  ← browser extension (client-side)
│   ├── manifest.json           ← Chrome MV3 manifest
│   ├── package.json            ← npm deps (esbuild)
│   ├── build.js                ← esbuild bundler → dist/
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── content/
│   │   └── content.js          ← injected into pages, handles OBSERVE + EXECUTE
│   ├── background/
│   │   └── service-worker.js   ← orchestrates observe-plan-act loop
│   ├── core/
│   │   ├── perception.js       ← DOM extraction (interactive elements)
│   │   ├── pii-detector.js     ← multi-layer PII detection + tokenization
│   │   ├── data-vault.js       ← local-only token↔value store (NEVER outbound)
│   │   ├── context-builder.js  ← assembles SanitizedContext for wire
│   │   ├── safety-rules.js     ← vets actions before execution
│   │   └── executor.js         ← click/type/scroll/select/navigate/wait
│   ├── utils/
│   │   └── uuid.js             ← minimal UUID v4 (no deps)
│   ├── models/                 ← (empty) for future ONNX models
│   └── dist/                   ← build output — load THIS in chrome://extensions
│       ├── manifest.json
│       ├── content.bundle.js
│       ├── service-worker.bundle.js
│       └── popup/
├── server/
│   ├── main.py                 ← FastAPI entry: /health, /api/plan
│   ├── requirements.txt
│   ├── .env.example            ← LLM provider config template
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py          ← Pydantic models (SanitizedContext, ActionPlan)
│   └── planner/
│       ├── __init__.py
│       └── planner.py          ← LLM prompt + OpenAI-compatible API call
└── docs/                       ← (future) documentation, diagrams
```

---

## ✅ Completed Tasks

- [x] Created `PROJECT_CONTEXT.md` for cross-model context sharing
- [x] Defined full architecture (outer loop + inner perception/action split)
- [x] Documented evaluation metrics and requirements
- [x] Defined 4 data contracts (SanitizedContext, ActionPlan, TokenMap, ActionResult)
- [x] **Phase 1: Scaffolding — DONE**
  - [x] Chrome extension (Manifest V3) with popup UI, content script, service worker
  - [x] FastAPI server with /api/plan endpoint
  - [x] esbuild bundler (npm run build → dist/)
  - [x] First successful build (content 16.8kb, service-worker 5.1kb, popup 1.8kb)
  - [x] All 6 core modules: perception, pii-detector, data-vault, context-builder, safety-rules, executor
  - [x] Planner with system prompt + OpenAI-compatible API (default: Ollama qwen2.5:7b)
- [x] **Phase 2: Perception Pipeline — DONE**
  - [x] Screenshot capture via chrome.tabs.captureVisibleTab + OffscreenCanvas
  - [x] Vision model: Transformers.js vit-gpt2 (captioning) + DETR (object detection)
  - [x] NER-based PII detection: Xenova/bert-base-NER via Transformers.js
  - [x] Visual redaction engine: blackout, blur (3-pass box), pixelate, colored mask
  - [x] PII region mapping: DOM rects → screenshot pixel coords for redaction
  - [x] Content script returns piiRegions for service worker to apply on screenshots
  - [x] Context builder + server schema accept optional screenshot_base64
  - [x] Build passing (content 24.4kb, service-worker 19.7kb, popup 1.8kb)

---

## 🚧 In Progress

_Phase 2 complete. Ready to start Phase 3._

---

## 📋 TODO / Backlog

### Phase 3: Redaction & Server Integration
- [x] Screenshot redaction pipeline: capture → detect PII regions → redact → encode ✓
- [x] Send redacted screenshot alongside DOM context to server ✓
- [x] Add VLM support on server (dual-mode: text LLM + multimodal VLM) ✓
- [x] Separate VLM_MODEL/VLM_BASE_URL config with .env support ✓
- [x] Created test shipping form page (test/test-form.html) ✓
- [ ] Integrate a specific VLM — need to pick: LLaVA:7b (Ollama) / Qwen-VL / Phi-3-Vision

### Phase 4: End-to-End Testing
- [ ] Test full observe-plan-act loop on test-form.html
- [ ] Verify PII detection + redaction on screenshot
- [ ] Verify token resolution in executor
- [ ] Implement re-observation verification (did the action work?)
- [ ] Handle edge cases: dynamic pages, SPAs, iframes

### Phase 5: Polish & Demo
- [ ] End-to-end demo video/recording
- [ ] Performance profiling (latency, memory, CPU/GPU)
- [ ] Extension icons and branding
- [ ] Cross-browser testing (Chrome + Firefox)
- [ ] README.md with setup instructions

---

## 🐛 Known Issues / Bugs

- **No extension icons yet** — Chrome will show default puzzle piece. Need 16/48/128px PNGs.
- **Vision models load from CDN on first use** — ~150MB total download (vit-gpt2 + DETR). Cached after first load.
- **NER model loads lazily** — first OBSERVE call triggers download (~50MB). Non-blocking, falls back to regex.
- **Server defaults to Ollama local** — need running models: `qwen2.5:7b` (text) and `llava:7b` (vision). Or configure .env for cloud.
- **VLM response parsing** — handles markdown-fenced JSON but untested with all providers.

---

## 💡 Important Notes & Conventions

- **No paid plans** — using free tiers across platforms.
- **Models in rotation:**
  - Claude Sonnet 5 (Claude browser)
  - Claude Opus 4.6 (Antigravity IDE)
  - Gemini 3.8 (Antigravity IDE)
  - Codex models
- **Convention:** Every AI model should read this file at the start of a session and update it before ending meaningful work.
- **Architecture images** were provided in the initial session (from Claude Sonnet 5 browser) — see the diagrams above for text versions.

---

## 🔗 Key References / Links

- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [Chrome Extension MV3 Docs](https://developer.chrome.com/docs/extensions/mv3/)
- [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [LLaVA](https://llava-vl.github.io/)
- [Qwen-VL](https://github.com/QwenLM/Qwen-VL)

---

## 🧠 Open Questions / Decisions Needed

1. **Which ViT variant for in-browser?** — MobileViT-S (~5.6M params) vs DeiT-tiny (~5.7M) vs custom distilled model?
2. **Which VLM for server?** — LLaVA-1.6-7B vs Qwen-VL-Chat vs InternVL-Chat vs Phi-3-Vision?
3. **Screenshot strategy?** — Full-page screenshot vs visible viewport vs DOM-only (no pixels)?
4. **PII detection scope?** — What types of PII to detect? (Names, emails, phones, addresses, faces, credit cards, passwords, SSNs?)
5. **Extension UI?** — Popup-based or sidebar-based? How does user initiate tasks?
