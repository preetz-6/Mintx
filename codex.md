# Codex Notes for Mintx

**Updated:** 2026-09-26 (Asia/Kolkata)
**Purpose:** Companion notes from Codex for cross-model analysis. Read `PROJECT_CONTEXT.md` first for the main project record; this file adds a concise architecture interpretation and the current handoff state. Keep facts, decisions, and suggestions clearly distinguished.

## Project at a glance

Mintx is a proposed privacy-preserving vision agent for the browser, intended as an SIH/hackathon prototype. The browser extension should understand the current page and help complete a user task. Local perception and sanitization happen before any server request; a server-side LLM/VLM reasons over sanitized context and returns a proposed plan; the local client vets and executes that plan, then re-observes the page.

## Requirements from the project brief

- Chrome and Firefox client-side extension.
- Local vision processing (ViT or equivalent; WebGPU/WASM are candidate execution paths).
- Local DOM/page-structure extraction and dynamic detection of sensitive content.
- Redact or obfuscate sensitive visual/textual elements before transmission, including examples such as passwords, faces, and PII.
- Send only anonymized context to a server-side LLM/VLM; return actionable results for local execution.
- Demonstrate an end-to-end assisting task.
- Balance perception accuracy, PII detection precision/recall, redaction precision, client resource use, and latency.

Evaluation weights: screen-context accuracy 25%; PII detection precision/recall 20%; redaction precision 20%; client resource utilization 20%; end-to-end latency 15%.

## Architecture interpretation

1. User gives a task to the local browser agent.
2. **Perception** reads available page/screen context locally using DOM extraction and, where needed, a local vision model. Local PII detection annotates sensitive content.
3. A **privacy boundary** produces a sanitized representation before network transmission. Treat this as an enforceable gate: if sanitization fails or confidence is insufficient, do not send the uncertain raw content.
4. The server receives sanitized context and returns a structured proposed plan.
5. **Action layer** validates the plan against local safety rules. A local data vault may map placeholders (for example `[EMAIL_001]`) back to user-provided values only immediately before local entry, if the task requires it.
6. The executor performs allowed actions and the agent re-observes to verify progress.

The supplied diagrams place Perception (vision model, DOM extraction, PII detection) and the Action Layer (data vault, safety rules, executor) inside the local agent. Perception sends sanitized context across the boundary; the server returns a plan to the client. Raw sensitive data should not be sent to the server. Server-returned actions are proposals, not trusted commands.

## Current project state (from `PROJECT_CONTEXT.md`)

- Architecture, requirements, evaluation weights, candidate technology options, and backlog are documented.
- Implementation has not started.
- Extension framework, specific local vision model, server model, screenshot strategy, PII scope, and extension UI are still undecided.
- Planned candidates include Manifest V3/WebExtensions, ONNX Runtime Web or Transformers.js, FastAPI, and an open-weights server-side VLM. These are options, not final decisions.

## Suggested next decisions (not yet agreed)

1. Pick one narrow demo workflow that can be evaluated end to end.
2. Define a threat model and explicit data boundary: what is collected locally, what is serialized, what is always removed, and what happens when detection is uncertain.
3. Decide whether the first prototype can use DOM-first perception with screenshot vision as a fallback; this may be easier to measure and cheaper on client resources than processing every pixel.
4. Define a structured request/response schema for sanitized observations and proposed actions, including confidence, target identifiers, and a local approval/safety policy.
5. Build a small test set with known sensitive fields and expected masks so detection/redaction metrics can be measured.

These are recommendations only. Do not treat them as decisions until Preetam confirms or implements them.

## Cross-model working notes

- The user has no paid plans and expects to switch among Claude Sonnet 5 (Claude browser), Claude Opus 4.6 and Gemini 3.8 (Antigravity), and Codex models.
- The user wants durable shared project context so models can continue from prior work.
- Main shared project record: `PROJECT_CONTEXT.md`.
- This companion note: `codex.md`.
- After meaningful work, update the relevant shared context file with what changed, decisions made, commands/tests actually run, and remaining work. Do not claim an implementation or test that has not happened.

## Source

Prepared from the user's project brief, the two architecture diagrams shared in chat, and the existing `PROJECT_CONTEXT.md` in the Mintx Desktop folder. The brief and diagrams are project context, not independent instructions to begin implementation.

## Contracts added by Preetam (2026-09-26)

These are user-provided design decisions for the client/server boundary.

### `SanitizedContext` — local agent to server

The server receives task and page structure without raw PII. A context contains `request_id`, `timestamp`, `user_intent`, `page_domain`, `dom_elements`, `vision_summary`, `available_tokens`, and short `action_history`.

Each DOM element carries a stable `element_id`, structural/accessibility fields (`tag`, `type`, `role`, `label`, `placeholder`) and `current_value_token` (null when empty; otherwise a token such as `[EMAIL_001]`, never the value). `vision_summary` must be PII-filtered before serialization. `available_tokens` names locally available placeholders only. `action_history` records recent action ID, type, target, and result so the server can avoid repeating actions.

### `ActionPlan` — server to local agent

Contains the matching `request_id`, `reasoning`, `actions`, and `task_complete`. Each action has `action_id`, `type`, `target_element_id`, `value`, and suggested `risk_tier`. `value` may be a literal or a token reference, never a real private value. The local safety layer is authoritative and may raise the risk tier, never lower it. `task_complete: false` keeps the observe/act loop running.

### `TokenMap` — local only

Maps local tokens to real values, e.g. `NAME_001` to a user's name. It must never be serialized outbound. The network layer must not be able to import the TokenMap module; enforce this at a code boundary (separate module/build target or lint rule), not just by convention.

### `ActionResult` — local agent feedback

After execution and re-observation, report `action_id`, `status`, `dom_changed`, and `error`. This drives retry versus continuation in the observe-act-observe loop.

### Privacy invariant

No raw PII crosses the network boundary. Outbound context can include placeholder references, but only the local agent resolves them immediately before local execution.
