/**
 * Mintx — Safety Rules
 *
 * Sits between the incoming ActionPlan and the Executor.
 * Evaluates each action against safety policies.
 * Can block or escalate actions — never lower risk tier.
 */

// Actions that could cause irreversible state changes
const HIGH_RISK_ACTIONS = ['submit', 'delete', 'purchase', 'pay', 'confirm'];
const DANGEROUS_PATTERNS = /delete|remove|cancel|unsubscribe|deactivate|close\s+account/i;

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
  evaluate(action) {
    // Rule 1: Never execute JavaScript via action values
    if (action.value && /javascript:/i.test(action.value)) {
      return { blocked: true, reason: 'JavaScript injection detected in action value' };
    }

    // Rule 2: Never navigate to data: or javascript: URIs
    if (action.type === 'navigate' && action.value) {
      if (/^(javascript|data|blob):/i.test(action.value)) {
        return { blocked: true, reason: 'Dangerous navigation URI scheme' };
      }
    }

    // Rule 3: Escalate risk tier for actions that look destructive
    if (action.type === 'click') {
      // Check if target text matches dangerous patterns
      if (action.target_text && DANGEROUS_PATTERNS.test(action.target_text)) {
        return {
          blocked: false,
          adjustedRisk: 'high',
          reason: 'Action text matches destructive pattern'
        };
      }
    }

    // Rule 4: Block actions with no target
    if (!action.target_element_id && action.type !== 'scroll' && action.type !== 'wait') {
      return { blocked: true, reason: 'Action has no target element' };
    }

    // Rule 5: Limit the number of consecutive type actions (data exfiltration defense)
    // (tracked externally if needed)

    return { blocked: false };
  }

  /**
   * Adjust risk tier — can only go UP, never down.
   */
  static adjustRisk(serverRisk, localRisk) {
    const tiers = ['low', 'medium', 'high', 'critical'];
    const serverIdx = tiers.indexOf(serverRisk || 'low');
    const localIdx = tiers.indexOf(localRisk || 'low');
    return tiers[Math.max(serverIdx, localIdx)];
  }
}
