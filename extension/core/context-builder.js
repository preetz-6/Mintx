/**
 * Mintx — Context Builder
 *
 * Assembles the SanitizedContext object that gets sent to the server.
 *
 * ⚠️  This module touches the network boundary.
 *     It must NEVER import DataVault or access raw PII values.
 *     It only works with already-tokenized data.
 */

import { v4 as uuidv4 } from '../utils/uuid.js';

/**
 * Build a SanitizedContext conforming to the wire protocol contract.
 *
 * @param {Object} params
 * @param {string} params.userIntent
 * @param {string} params.pageDomain
 * @param {Array}  params.domElements — already tokenized (no raw values)
 * @param {string} params.visionSummary — already PII-filtered
 * @param {string[]} params.availableTokens — token keys only
 * @param {Array}  params.actionHistory
 * @param {string|null} params.screenshotBase64 — redacted screenshot (data URL), optional
 * @returns {Object} SanitizedContext
 */
export function buildSanitizedContext({
  userIntent,
  pageDomain,
  domElements,
  visionSummary,
  availableTokens,
  actionHistory,
  screenshotBase64 = null,
  privacyVerifiedScreenshot = false
}) {
  const context = {
    request_id: `req_${uuidv4().slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    user_intent: sanitizeOutboundText(userIntent),
    page_domain: pageDomain,
    dom_elements: domElements.map(el => ({
      element_id: el.element_id,
      tag: el.tag,
      type: el.type,
      role: el.role,
      label: sanitizeOutboundText(el.label),
      placeholder: sanitizeOutboundText(el.placeholder),
      current_value_token: el.current_value_token || null
    })),
    vision_summary: sanitizeOutboundText(visionSummary),
    available_tokens: availableTokens,
    action_history: actionHistory.slice(-10).map(entry => ({
      action_id: sanitizeOutboundText(entry.action_id),
      type: sanitizeOutboundText(entry.type),
      target: sanitizeOutboundText(entry.target),
      result: sanitizeOutboundText(entry.result)
    }))
  };

  // Only include screenshot if available (keeps payload small otherwise)
  // Do not transmit raw or incompletely sanitized pixels. Enable this only
  // after OCR/text-region redaction is implemented and verified locally.
  if (screenshotBase64 && privacyVerifiedScreenshot === true) {
    context.screenshot_base64 = screenshotBase64;
  }

  return context;
}

// Last-resort network-boundary scrub. The content script also performs local
// NER-based sanitization; this catches common PII if a caller forgets to do so.
const OUTBOUND_PII_PATTERNS = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]'],
  [/\b\d{3}-?\d{2}-?\d{4}\b/g, '[SSN_REDACTED]'],
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[ID_REDACTED]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[ID_REDACTED]'],
  [/\b(?:\d[ -]*?){13,19}\b/g, '[CARD_REDACTED]'],
  [/(?<!\w)(?:\+?\d[\d().\s-]{7,}\d)(?!\w)/g, '[PHONE_REDACTED]']
];

export function sanitizeOutboundText(value) {
  if (typeof value !== 'string') return value ?? null;
  if (value === '[REDACTED]') return value;
  return OUTBOUND_PII_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  );
}
