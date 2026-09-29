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
  screenshotBase64 = null
}) {
  const context = {
    request_id: `req_${uuidv4().slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    user_intent: userIntent,
    page_domain: pageDomain,
    dom_elements: domElements.map(el => ({
      element_id: el.element_id,
      tag: el.tag,
      type: el.type,
      role: el.role,
      label: el.label,
      placeholder: el.placeholder,
      current_value_token: el.current_value_token || null
    })),
    vision_summary: visionSummary,
    available_tokens: availableTokens,
    action_history: actionHistory.slice(-10) // keep last 10 actions
  };

  // Only include screenshot if available (keeps payload small otherwise)
  if (screenshotBase64) {
    context.screenshot_base64 = screenshotBase64;
  }

  return context;
}
