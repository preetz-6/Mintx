/**
 * Mintx — Data Vault
 *
 * Local-only storage mapping tokens to real PII values.
 *
 * ⚠️  HARD RULE: This module must NEVER be imported by any code
 *     that touches the network layer. Enforce at code boundary.
 *     The network module (context-builder.js, service-worker.js)
 *     must never import or reference this file.
 *
 * Only the Executor (which types real values into DOM fields)
 * and the content script (which populates it) should use this.
 */

export class DataVault {
  constructor() {
    /** @type {Map<string, string>} token → real value */
    this._store = new Map();
    /** @type {Map<string, number>} category → counter */
    this._counters = new Map();
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
    // Check if value already stored
    for (const [token, val] of this._store) {
      if (val === realValue && token.startsWith(category)) {
        return token;
      }
    }

    // Create new token
    const count = (this._counters.get(category) || 0) + 1;
    this._counters.set(category, count);
    const token = `${category}_${String(count).padStart(3, '0')}`;
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
    // Strip brackets if present
    const clean = token.replace(/^\[|\]$/g, '');
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
      map[key] = true; // values intentionally omitted
    }
    return map;
  }

  /** Replace exact locally-held PII values in free text with their tokens. */
  sanitizeKnownValues(text) {
    let sanitized = String(text ?? '');
    const entries = [...this._store.entries()]
      .sort((a, b) => b[1].length - a[1].length);
    for (const [token, value] of entries) {
      if (!value) continue;
      sanitized = sanitized.split(value).join(`[${token}]`);
    }
    return sanitized;
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
}
