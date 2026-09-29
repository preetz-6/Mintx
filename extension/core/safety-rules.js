/**
 * Mintx — Safety Rules
 *
 * Sits between the incoming ActionPlan and the Executor.
 * Evaluates each action against safety policies.
 * Can block or escalate actions — never lower risk tier.
 */

const ACTION_TYPES = new Set(['click', 'type', 'scroll', 'navigate', 'select', 'wait']);
const RISK_TIERS = ['low', 'medium', 'high', 'critical'];
const DANGEROUS_PATTERNS = /delete|remove|cancel|unsubscribe|deactivate|close\s+account|submit|purchase|pay|place\s+order|confirm/i;

export class SafetyRules {
  constructor() {
    this.blockedDomains = []; // user can configure blocked domains
    this.requireConfirmation = true; // for high-risk actions
  }

  /**
   * Evaluate an action against safety rules.
   *
   * @param {Object} action — from ActionPlan
   * @returns {{ blocked: boolean, reason?: string, adjustedRisk?: string }}
   */
  evaluate(action, targetElement = null) {
    if (!action || !ACTION_TYPES.has(action.type)) {
      return { blocked: true, reason: 'Unsupported action type' };
    }

    // Rule 1: Never execute JavaScript via action values
    if (action.value && /javascript:/i.test(action.value)) {
      return { blocked: true, reason: 'JavaScript injection detected in action value' };
    }

    // Rule 2: Never navigate to data: or javascript: URIs
    if (action.type === 'navigate' && action.value) {
      try {
        const url = new URL(action.value, window.location.href);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { blocked: true, reason: 'Only HTTP(S) navigation is allowed' };
        }
      } catch {
        return { blocked: true, reason: 'Invalid navigation URL' };
      }
    }

    // Navigation acts on the current tab and therefore has no element target.
    if (!action.target_element_id && !['scroll', 'wait', 'navigate'].includes(action.type)) {
      return { blocked: true, reason: 'Action has no target element' };
    }

    const targetText = [
      targetElement?.innerText,
      targetElement?.getAttribute?.('aria-label'),
      targetElement?.getAttribute?.('title'),
      targetElement?.value,
      action.target_text
    ].filter(Boolean).join(' ').slice(0, 500);
    const isSubmitControl = targetElement?.type === 'submit' ||
      targetElement?.getAttribute?.('type') === 'submit';
    const localRisk = (isSubmitControl || DANGEROUS_PATTERNS.test(targetText)) ? 'high' : 'low';
    const adjustedRisk = SafetyRules.adjustRisk(action.risk_tier, localRisk);

    return {
      blocked: false,
      adjustedRisk,
      requiresConfirmation: ['high', 'critical'].includes(adjustedRisk),
      reason: localRisk === 'high' ? 'Target appears to perform a consequential action' : undefined
    };
  }

  /**
   * Adjust risk tier — can only go UP, never down.
   */
  static adjustRisk(serverRisk, localRisk) {
    const serverIdx = RISK_TIERS.indexOf(serverRisk);
    const localIdx = RISK_TIERS.indexOf(localRisk);
    return RISK_TIERS[Math.max(serverIdx < 0 ? 0 : serverIdx, localIdx < 0 ? 0 : localIdx)];
  }
}
