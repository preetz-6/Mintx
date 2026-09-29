/**
 * Mintx — Content Script
 *
 * Injected into every page. Handles:
 * - DOM observation (extracting interactive elements)
 * - PII detection in visible text/fields
 * - PII region mapping for screenshot redaction
 * - NER-based PII detection in visible text
 * - Action execution (click, type, scroll)
 * - Token mapping (via DataVault — local only)
 *
 * Communicates with service-worker via chrome.runtime messaging.
 */

import { extractDomElements } from '../core/perception.js';
import { detectAndTokenize, sanitizeText } from '../core/pii-detector.js';
import { initNerModel, scanTextForPII, isNerReady } from '../core/ner-detector.js';
import { DataVault } from '../core/data-vault.js';
import { SafetyRules } from '../core/safety-rules.js';
import { Executor } from '../core/executor.js';

const vault = new DataVault();
const safety = new SafetyRules();
const executor = new Executor(vault);

// Lazy-init NER model on first observe
let nerInitAttempted = false;

// ── Message Handler ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OBSERVE') {
    handleObserve(msg.payload?.userIntent || '').then(sendResponse);
    return true; // async
  }

  if (msg.type === 'SANITIZE_TEXT') {
    sanitizeFreeText(msg.payload?.text || '').then(text => sendResponse({ text }));
    return true;
  }

  if (msg.type === 'EXECUTE_ACTION') {
    handleExecute(msg.payload).then(sendResponse);
    return true;
  }
});

// ── Observe: Extract DOM + detect PII + tokenize + map regions ──

async function handleObserve(userIntent) {
  try {
    // Initialize NER before preparing any text that may cross the network.
    if (!nerInitAttempted) {
      nerInitAttempted = true;
      await initNerModel().catch(err => {
        console.warn('[Mintx] NER init failed, using regex-only:', err.message);
      });
    }

    // 1. Extract interactive DOM elements (with rects + raw values)
    const rawElements = extractDomElements(document);

    // 2. Detect PII in element values and visible text, tokenize them
    const { elements, tokens } = detectAndTokenize(rawElements, vault);

    // 3. NER scan on visible page text (if model loaded)
    if (isNerReady()) {
      const visibleText = getVisibleText(document);
      const nerFindings = await scanTextForPII(visibleText);

      // Store NER-detected PII in vault (supplements regex detection)
      for (const finding of nerFindings) {
        vault.store(finding.category, finding.value);
      }
    }

    // 4. Sanitize all free text locally before returning it to the worker.
    const safeElements = await Promise.all(elements.map(async el => ({
      ...el,
      label: await sanitizeFreeText(el.label),
      placeholder: await sanitizeFreeText(el.placeholder)
    })));
    const visionSummary = await sanitizeFreeText(generateBasicVisionSummary(document));
    const sanitizedUserIntent = await sanitizeFreeText(userIntent);

    // 5. Map PII elements to screenshot pixel regions for visual redaction
    //    (service worker uses these to redact the screenshot)
    const dpr = window.devicePixelRatio || 1;
    const piiRegions = buildPIIRegions(rawElements, elements, dpr);

    return {
      domElements: safeElements,
      visionSummary,
      sanitizedUserIntent,
      availableTokens: Object.keys(vault.getTokenMap()),
      piiRegions,
      piiScanReady: isNerReady()
    };
  } catch (err) {
    console.error('[Mintx] Observe error:', err);
    return null;
  }
}

async function sanitizeFreeText(text) {
  if (!text) return '';
  let result = String(text);

  if (isNerReady()) {
    try {
      const findings = await scanTextForPII(result);
      for (const finding of findings.sort((a, b) => b.start - a.start)) {
        if (!finding.category || finding.start < 0 || finding.end <= finding.start) continue;
        const value = result.slice(finding.start, finding.end) || finding.value;
        if (!value.trim()) continue;
        const token = vault.store(finding.category, value.trim());
        result = result.slice(0, finding.start) + `[${token}]` + result.slice(finding.end);
      }
    } catch (err) {
      console.warn('[Mintx] NER text sanitization failed:', err.message);
    }
  }

  return vault.sanitizeKnownValues(sanitizeText(result, vault));
}

// ── Execute: Vet action through safety rules, then execute ──

async function handleExecute(action) {
  try {
    // Safety check
    const targetElement = action.target_element_id
      ? [...document.querySelectorAll('[data-mintx-id]')]
          .find(el => el.dataset.mintxId === action.target_element_id) || null
      : null;
    const safetyResult = safety.evaluate(action, targetElement);
    if (safetyResult.blocked) {
      return {
        action_id: action.action_id,
        status: 'blocked',
        dom_changed: false,
        error: `Blocked by safety rule: ${safetyResult.reason}`
      };
    }

    if (action.target_element_id && !targetElement) {
      return {
        action_id: action.action_id,
        status: 'error',
        dom_changed: false,
        error: 'Target element is not present on the current page'
      };
    }

    if (safetyResult.requiresConfirmation) {
      const description = targetElement?.innerText?.trim() ||
        targetElement?.getAttribute('aria-label') || action.type;
      const accepted = window.confirm(
        `Mintx is about to perform a ${safetyResult.adjustedRisk}-risk action: ${description}. Continue?`
      );
      if (!accepted) {
        return {
          action_id: action.action_id,
          status: 'blocked',
          dom_changed: false,
          error: 'User declined the local confirmation'
        };
      }
    }

    // Execute
    const result = await executor.execute(action);
    return result;
  } catch (err) {
    return {
      action_id: action.action_id,
      status: 'error',
      dom_changed: false,
      error: err.message
    };
  }
}

// ── PII Region Mapping ──

/**
 * Build redaction regions from DOM elements that contain PII.
 * Maps element bounding rects to screenshot pixel coordinates.
 *
 * @param {Array} rawElements — with _node refs and rect
 * @param {Array} sanitizedElements — with current_value_token set
 * @param {number} dpr — devicePixelRatio
 * @returns {Array<{ x, y, w, h, category, method }>}
 */
function buildPIIRegions(rawElements, sanitizedElements, dpr) {
  const regions = [];

  for (let i = 0; i < sanitizedElements.length; i++) {
    const sanitized = sanitizedElements[i];
    const raw = rawElements[i];

    // If this element has a PII token, mark its region for redaction
    if (sanitized.current_value_token && sanitized.current_value_token !== null) {
      const rect = raw.rect;
      if (!rect || rect.w === 0 || rect.h === 0) continue;

      // Extract category from token: "[EMAIL_001]" → "EMAIL"
      const match = sanitized.current_value_token.match(/\[([A-Z]+)_\d+\]/);
      const category = match ? match[1] : 'UNKNOWN';

      regions.push({
        x: Math.round(rect.x * dpr),
        y: Math.round(rect.y * dpr),
        w: Math.round(rect.w * dpr),
        h: Math.round(rect.h * dpr),
        category,
        method: null // let redactor use default for category
      });
    }
  }

  // Also scan for password fields (always redact, even if empty)
  const passwordFields = document.querySelectorAll('input[type="password"]');
  for (const field of passwordFields) {
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    regions.push({
      x: Math.round(rect.x * dpr),
      y: Math.round(rect.y * dpr),
      w: Math.round(rect.width * dpr),
      h: Math.round(rect.height * dpr),
      category: 'PASSWORD',
      method: 'blackout'
    });
  }

  return regions;
}

// ── DOM Vision Summary (fallback when ViT not loaded) ──

function generateBasicVisionSummary(doc) {
  const forms = doc.querySelectorAll('form').length;
  const inputs = doc.querySelectorAll('input, textarea, select').length;
  const buttons = doc.querySelectorAll('button, [type="submit"], [role="button"]').length;
  const links = doc.querySelectorAll('a').length;
  const images = doc.querySelectorAll('img').length;
  const headings = doc.querySelectorAll('h1, h2, h3').length;

  const parts = ['Web page'];
  if (forms > 0) parts.push(`${forms} form(s)`);
  if (inputs > 0) parts.push(`${inputs} input field(s)`);
  if (buttons > 0) parts.push(`${buttons} button(s)`);
  if (links > 0) parts.push(`${links} link(s)`);
  if (images > 0) parts.push(`${images} image(s)`);
  if (headings > 0) parts.push(`${headings} heading(s)`);

  return parts.join(', ');
}

// ── Visible Text Extraction ──

/**
 * Extract visible text content from the page for NER scanning.
 * Limited to first ~2000 chars to keep inference fast.
 */
function getVisibleText(doc) {
  const walker = doc.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip script/style/hidden elements
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'svg'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }

        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
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
  const MAX_LEN = 2000;

  while (walker.nextNode() && totalLen < MAX_LEN) {
    const text = walker.currentNode.textContent.trim();
    chunks.push(text);
    totalLen += text.length;
  }

  return chunks.join(' ').substring(0, MAX_LEN);
}
