(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // core/perception.js
  var INTERACTIVE_SELECTORS = [
    "input",
    "textarea",
    "select",
    "button",
    '[role="button"]',
    '[role="textbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[contenteditable="true"]',
    "a[href]",
    '[type="submit"]'
  ];
  var elementIdCounter = 0;
  function extractDomElements(doc) {
    const selector = INTERACTIVE_SELECTORS.join(", ");
    const nodes = doc.querySelectorAll(selector);
    const elements = [];
    for (const node of nodes) {
      if (isHidden(node)) continue;
      const el = {
        element_id: node.dataset.mintxId || assignId(node),
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute("type") || null,
        role: node.getAttribute("role") || getImplicitRole(node),
        label: getLabel(node, doc),
        placeholder: node.getAttribute("placeholder") || null,
        current_value: getCurrentValue(node),
        // Bounding rect for future visual cross-referencing
        rect: getRect(node),
        // DOM ref — NOT serialized, used locally for execution
        _node: node
      };
      elements.push(el);
    }
    return elements;
  }
  function assignId(node) {
    const id = `el_${++elementIdCounter}`;
    node.dataset.mintxId = id;
    return id;
  }
  function isHidden(node) {
    const style = getComputedStyle(node);
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || node.offsetWidth === 0 && node.offsetHeight === 0;
  }
  function getImplicitRole(node) {
    const tag = node.tagName.toLowerCase();
    const type = (node.getAttribute("type") || "").toLowerCase();
    const roleMap = {
      "a": "link",
      "button": "button",
      "select": "listbox",
      "textarea": "textbox"
    };
    if (tag === "input") {
      const inputRoles = {
        "text": "textbox",
        "email": "textbox",
        "tel": "textbox",
        "url": "textbox",
        "search": "searchbox",
        "password": "textbox",
        "number": "spinbutton",
        "checkbox": "checkbox",
        "radio": "radio",
        "submit": "button",
        "reset": "button",
        "button": "button"
      };
      return inputRoles[type] || "textbox";
    }
    return roleMap[tag] || null;
  }
  function getLabel(node, doc) {
    if (node.id) {
      const label = doc.querySelector(`label[for="${node.id}"]`);
      if (label) return label.textContent.trim();
    }
    const parentLabel = node.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    const ariaLabel = node.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = doc.getElementById(labelledBy);
      if (ref) return ref.textContent.trim();
    }
    if (["button", "a"].includes(node.tagName.toLowerCase())) {
      return node.textContent.trim().substring(0, 80) || null;
    }
    return null;
  }
  function getCurrentValue(node) {
    const tag = node.tagName.toLowerCase();
    if (tag === "select") {
      const selected = node.options[node.selectedIndex];
      return selected ? selected.textContent.trim() : null;
    }
    if (tag === "input" || tag === "textarea") {
      return node.value || null;
    }
    return null;
  }
  function getRect(node) {
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // core/pii-detector.js
  var PII_CATEGORIES = {
    EMAIL: {
      regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      inputTypes: ["email"],
      labelKeywords: ["email", "e-mail", "mail"]
    },
    PHONE: {
      regex: /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g,
      inputTypes: ["tel"],
      labelKeywords: ["phone", "mobile", "cell", "telephone", "contact number"]
    },
    NAME: {
      regex: null,
      // Names are too ambiguous for regex — rely on label heuristics + NER
      inputTypes: [],
      labelKeywords: ["name", "full name", "first name", "last name", "surname", "given name"]
    },
    PASSWORD: {
      regex: null,
      // Never read password values
      inputTypes: ["password"],
      labelKeywords: ["password", "passwd", "pin", "passcode"]
    },
    SSN: {
      regex: /\b\d{3}-?\d{2}-?\d{4}\b/g,
      inputTypes: [],
      labelKeywords: ["ssn", "social security", "tax id", "sin"]
    },
    CREDIT_CARD: {
      regex: /\b(?:\d[ -]*?){13,19}\b/g,
      inputTypes: [],
      labelKeywords: ["card number", "credit card", "debit card", "card no"]
    },
    ADDRESS: {
      regex: null,
      inputTypes: [],
      labelKeywords: ["address", "street", "city", "zip", "postal", "pincode", "pin code"]
    },
    AADHAAR: {
      regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
      inputTypes: [],
      labelKeywords: ["aadhaar", "aadhar", "uid"]
    },
    PAN: {
      regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
      inputTypes: [],
      labelKeywords: ["pan", "pan number", "pan card"]
    }
  };
  function detectAndTokenize(rawElements, vault2) {
    const sanitizedElements = [];
    for (const el of rawElements) {
      const sanitized = { ...el };
      delete sanitized._node;
      delete sanitized.rect;
      const category = detectCategory(el);
      if (category && el.current_value) {
        const token = vault2.store(category, el.current_value);
        sanitized.current_value_token = `[${token}]`;
      } else if (category === "PASSWORD") {
        sanitized.current_value_token = el.current_value ? "[REDACTED]" : null;
      } else {
        if (el.current_value) {
          const regexResult = regexScan(el.current_value);
          if (regexResult) {
            const token = vault2.store(regexResult.category, el.current_value);
            sanitized.current_value_token = `[${token}]`;
          } else {
            sanitized.current_value_token = null;
          }
        } else {
          sanitized.current_value_token = null;
        }
      }
      delete sanitized.current_value;
      sanitizedElements.push(sanitized);
    }
    return {
      elements: sanitizedElements,
      tokens: Object.keys(vault2.getTokenMap())
    };
  }
  function detectCategory(el) {
    const inputType = (el.type || "").toLowerCase();
    const label = (el.label || "").toLowerCase();
    for (const [category, rules] of Object.entries(PII_CATEGORIES)) {
      if (rules.inputTypes.includes(inputType)) {
        return category;
      }
      if (rules.labelKeywords.some((kw) => label.includes(kw))) {
        return category;
      }
    }
    return null;
  }
  function regexScan(value) {
    for (const [category, rules] of Object.entries(PII_CATEGORIES)) {
      if (!rules.regex) continue;
      rules.regex.lastIndex = 0;
      if (rules.regex.test(value)) {
        return { category, match: value };
      }
    }
    return null;
  }

  // core/ner-detector.js
  var nerPipeline = null;
  var isLoading = false;
  async function initNerModel(onProgress) {
    if (nerPipeline || isLoading) return;
    isLoading = true;
    try {
      const { pipeline } = await import(
        /* webpackIgnore: true */
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
      );
      nerPipeline = await pipeline(
        "token-classification",
        "Xenova/bert-base-NER",
        {
          device: "wasm",
          // NER is lightweight, WASM is fine
          progress_callback: onProgress || void 0
        }
      );
      isLoading = false;
    } catch (err) {
      isLoading = false;
      console.error("[Mintx] NER model init failed:", err);
      throw err;
    }
  }
  async function detectEntities(text) {
    if (!nerPipeline) {
      return [];
    }
    if (!text || text.length < 2) return [];
    try {
      const results = await nerPipeline(text, {
        ignore_labels: ["O"]
        // skip non-entity tokens
      });
      return mergeSubwordTokens(results);
    } catch (err) {
      console.error("[Mintx] NER detection failed:", err);
      return [];
    }
  }
  var NER_TO_PII = {
    "PER": "NAME",
    "LOC": "ADDRESS",
    "ORG": "ORG",
    // organizations — might contain PII context
    "MISC": null
    // miscellaneous — skip unless relevant
  };
  function mergeSubwordTokens(tokens) {
    const merged = [];
    let current = null;
    for (const token of tokens) {
      const [prefix, label] = token.entity.includes("-") ? token.entity.split("-") : [token.entity, token.entity];
      const piiCategory = NER_TO_PII[label] || null;
      if (prefix === "B" || !current || current.label !== label) {
        if (current) merged.push(current);
        current = {
          entity: token.entity,
          label,
          piiCategory,
          word: cleanToken(token.word),
          score: token.score,
          start: token.start,
          end: token.end
        };
      } else {
        current.word += cleanToken(token.word);
        current.end = token.end;
        current.score = Math.min(current.score, token.score);
      }
    }
    if (current) merged.push(current);
    return merged.filter((e) => e.piiCategory && e.score > 0.5);
  }
  function cleanToken(word) {
    if (word.startsWith("##")) {
      return word.slice(2);
    }
    return word.startsWith(" ") ? word : ` ${word}`;
  }
  async function scanTextForPII(text) {
    const entities = await detectEntities(text);
    return entities.map((e) => ({
      category: e.piiCategory,
      value: e.word.trim(),
      start: e.start,
      end: e.end,
      score: e.score
    }));
  }
  function isNerReady() {
    return !!nerPipeline;
  }

  // core/data-vault.js
  var DataVault = class {
    constructor() {
      this._store = /* @__PURE__ */ new Map();
      this._counters = /* @__PURE__ */ new Map();
    }
    /**
     * Store a real value and return a token key.
     * If the same value already has a token, return the existing one.
     *
     * @param {string} category — e.g. 'EMAIL', 'NAME', 'PHONE'
     * @param {string} realValue — the actual PII
     * @returns {string} token key (e.g. 'EMAIL_001')
     */
    store(category, realValue) {
      for (const [token2, val] of this._store) {
        if (val === realValue && token2.startsWith(category)) {
          return token2;
        }
      }
      const count = (this._counters.get(category) || 0) + 1;
      this._counters.set(category, count);
      const token = `${category}_${String(count).padStart(3, "0")}`;
      this._store.set(token, realValue);
      return token;
    }
    /**
     * Resolve a token to its real value.
     * Used ONLY by the executor, right before typing into a field.
     *
     * @param {string} token — e.g. 'EMAIL_001' or '[EMAIL_001]'
     * @returns {string|null}
     */
    resolve(token) {
      const clean = token.replace(/^\[|\]$/g, "");
      return this._store.get(clean) || null;
    }
    /**
     * Get a copy of the token map (for listing available tokens).
     * Returns token keys only — NOT values. Values never leave this module
     * except through resolve() for local execution.
     *
     * @returns {Object} { TOKEN_001: true, TOKEN_002: true, ... }
     */
    getTokenMap() {
      const map = {};
      for (const key of this._store.keys()) {
        map[key] = true;
      }
      return map;
    }
    /**
     * Clear all stored tokens. Call when a task completes.
     */
    clear() {
      this._store.clear();
      this._counters.clear();
    }
    /**
     * Number of stored tokens.
     */
    get size() {
      return this._store.size;
    }
  };

  // core/safety-rules.js
  var DANGEROUS_PATTERNS = /delete|remove|cancel|unsubscribe|deactivate|close\s+account/i;
  var SafetyRules = class {
    constructor() {
      this.blockedDomains = [];
      this.requireConfirmation = true;
    }
    /**
     * Evaluate an action against safety rules.
     *
     * @param {Object} action — from ActionPlan
     * @returns {{ blocked: boolean, reason?: string, adjustedRisk?: string }}
     */
    evaluate(action) {
      if (action.value && /javascript:/i.test(action.value)) {
        return { blocked: true, reason: "JavaScript injection detected in action value" };
      }
      if (action.type === "navigate" && action.value) {
        if (/^(javascript|data|blob):/i.test(action.value)) {
          return { blocked: true, reason: "Dangerous navigation URI scheme" };
        }
      }
      if (action.type === "click") {
        if (action.target_text && DANGEROUS_PATTERNS.test(action.target_text)) {
          return {
            blocked: false,
            adjustedRisk: "high",
            reason: "Action text matches destructive pattern"
          };
        }
      }
      if (!action.target_element_id && action.type !== "scroll" && action.type !== "wait") {
        return { blocked: true, reason: "Action has no target element" };
      }
      return { blocked: false };
    }
    /**
     * Adjust risk tier — can only go UP, never down.
     */
    static adjustRisk(serverRisk, localRisk) {
      const tiers = ["low", "medium", "high", "critical"];
      const serverIdx = tiers.indexOf(serverRisk || "low");
      const localIdx = tiers.indexOf(localRisk || "low");
      return tiers[Math.max(serverIdx, localIdx)];
    }
  };

  // core/executor.js
  var Executor = class {
    /**
     * @param {import('./data-vault.js').DataVault} vault
     */
    constructor(vault2) {
      this.vault = vault2;
    }
    /**
     * Execute a single action.
     *
     * @param {Object} action — from ActionPlan
     * @returns {Promise<Object>} ActionResult
     */
    async execute(action) {
      const startDom = document.body.innerHTML.length;
      try {
        switch (action.type) {
          case "click":
            await this._click(action);
            break;
          case "type":
            await this._type(action);
            break;
          case "scroll":
            await this._scroll(action);
            break;
          case "navigate":
            await this._navigate(action);
            break;
          case "select":
            await this._select(action);
            break;
          case "wait":
            await this._wait(action);
            break;
          default:
            throw new Error(`Unknown action type: ${action.type}`);
        }
        await sleep(150);
        const endDom = document.body.innerHTML.length;
        return {
          action_id: action.action_id,
          status: "success",
          dom_changed: endDom !== startDom,
          error: null
        };
      } catch (err) {
        return {
          action_id: action.action_id,
          status: "error",
          dom_changed: false,
          error: err.message
        };
      }
    }
    // ── Action Implementations ──
    async _click(action) {
      const el = this._findElement(action.target_element_id);
      el.focus();
      el.click();
    }
    async _type(action) {
      const el = this._findElement(action.target_element_id);
      el.focus();
      let value = action.value || "";
      if (/^\[.+\]$/.test(value)) {
        const resolved = this.vault.resolve(value);
        if (resolved === null) {
          throw new Error(`Token ${value} not found in vault`);
        }
        value = resolved;
      }
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      for (const char of value) {
        el.value += char;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
        await sleep(20);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    async _scroll(action) {
      const amount = action.value || 300;
      const direction = action.direction || "down";
      if (action.target_element_id) {
        const el = this._findElement(action.target_element_id);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.scrollBy({
          top: direction === "up" ? -amount : amount,
          behavior: "smooth"
        });
      }
    }
    async _select(action) {
      const el = this._findElement(action.target_element_id);
      if (el.tagName.toLowerCase() !== "select") {
        throw new Error("Target is not a select element");
      }
      let value = action.value || "";
      if (/^\[.+\]$/.test(value)) {
        value = this.vault.resolve(value) || value;
      }
      const option = Array.from(el.options).find(
        (opt) => opt.value === value || opt.textContent.trim() === value
      );
      if (!option) {
        throw new Error(`No matching option for "${value}"`);
      }
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    async _navigate(action) {
      window.location.href = action.value;
    }
    async _wait(action) {
      const ms = parseInt(action.value, 10) || 1e3;
      await sleep(Math.min(ms, 5e3));
    }
    // ── Helpers ──
    _findElement(elementId) {
      const el = document.querySelector(`[data-mintx-id="${elementId}"]`);
      if (!el) {
        throw new Error(`Element ${elementId} not found in DOM`);
      }
      return el;
    }
  };
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // content/content.js
  var vault = new DataVault();
  var safety = new SafetyRules();
  var executor = new Executor(vault);
  var nerInitAttempted = false;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "OBSERVE") {
      handleObserve().then(sendResponse);
      return true;
    }
    if (msg.type === "EXECUTE_ACTION") {
      handleExecute(msg.payload).then(sendResponse);
      return true;
    }
  });
  async function handleObserve() {
    try {
      if (!nerInitAttempted) {
        nerInitAttempted = true;
        initNerModel().catch((err) => {
          console.warn("[Mintx] NER init failed, using regex-only:", err.message);
        });
      }
      const rawElements = extractDomElements(document);
      const { elements, tokens } = detectAndTokenize(rawElements, vault);
      if (isNerReady()) {
        const visibleText = getVisibleText(document);
        const nerFindings = await scanTextForPII(visibleText);
        for (const finding of nerFindings) {
          vault.store(finding.category, finding.value);
        }
      }
      const visionSummary = generateBasicVisionSummary(document);
      const dpr = window.devicePixelRatio || 1;
      const piiRegions = buildPIIRegions(rawElements, elements, dpr);
      return {
        domElements: elements,
        visionSummary,
        availableTokens: Object.keys(vault.getTokenMap()),
        piiRegions
      };
    } catch (err) {
      console.error("[Mintx] Observe error:", err);
      return null;
    }
  }
  async function handleExecute(action) {
    try {
      const safetyResult = safety.evaluate(action);
      if (safetyResult.blocked) {
        return {
          action_id: action.action_id,
          status: "blocked",
          dom_changed: false,
          error: `Blocked by safety rule: ${safetyResult.reason}`
        };
      }
      const result = await executor.execute(action);
      return result;
    } catch (err) {
      return {
        action_id: action.action_id,
        status: "error",
        dom_changed: false,
        error: err.message
      };
    }
  }
  function buildPIIRegions(rawElements, sanitizedElements, dpr) {
    const regions = [];
    for (let i = 0; i < sanitizedElements.length; i++) {
      const sanitized = sanitizedElements[i];
      const raw = rawElements[i];
      if (sanitized.current_value_token && sanitized.current_value_token !== null) {
        const rect = raw.rect;
        if (!rect || rect.w === 0 || rect.h === 0) continue;
        const match = sanitized.current_value_token.match(/\[([A-Z]+)_\d+\]/);
        const category = match ? match[1] : "UNKNOWN";
        regions.push({
          x: Math.round(rect.x * dpr),
          y: Math.round(rect.y * dpr),
          w: Math.round(rect.w * dpr),
          h: Math.round(rect.h * dpr),
          category,
          method: null
          // let redactor use default for category
        });
      }
    }
    const passwordFields = document.querySelectorAll('input[type="password"]');
    for (const field of passwordFields) {
      const rect = field.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      regions.push({
        x: Math.round(rect.x * dpr),
        y: Math.round(rect.y * dpr),
        w: Math.round(rect.width * dpr),
        h: Math.round(rect.height * dpr),
        category: "PASSWORD",
        method: "blackout"
      });
    }
    return regions;
  }
  function generateBasicVisionSummary(doc) {
    const title = doc.title || "Untitled page";
    const forms = doc.querySelectorAll("form").length;
    const inputs = doc.querySelectorAll("input, textarea, select").length;
    const buttons = doc.querySelectorAll('button, [type="submit"], [role="button"]').length;
    const links = doc.querySelectorAll("a").length;
    const images = doc.querySelectorAll("img").length;
    const headings = doc.querySelectorAll("h1, h2, h3").length;
    const parts = [`Page: "${title}"`];
    if (forms > 0) parts.push(`${forms} form(s)`);
    if (inputs > 0) parts.push(`${inputs} input field(s)`);
    if (buttons > 0) parts.push(`${buttons} button(s)`);
    if (links > 0) parts.push(`${links} link(s)`);
    if (images > 0) parts.push(`${images} image(s)`);
    if (headings > 0) parts.push(`${headings} heading(s)`);
    const h1 = doc.querySelector("h1");
    if (h1) parts.push(`Main heading: "${h1.textContent.trim().substring(0, 60)}"`);
    return parts.join(", ");
  }
  function getVisibleText(doc) {
    const walker = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "svg"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden") {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
          if (text.length < 2) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const chunks = [];
    let totalLen = 0;
    const MAX_LEN = 2e3;
    while (walker.nextNode() && totalLen < MAX_LEN) {
      const text = walker.currentNode.textContent.trim();
      chunks.push(text);
      totalLen += text.length;
    }
    return chunks.join(" ").substring(0, MAX_LEN);
  }
})();
//# sourceMappingURL=content.bundle.js.map
