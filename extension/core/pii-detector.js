/**
 * Mintx — PII Detector & Tokenizer
 *
 * Scans DOM element values for PII patterns and replaces them
 * with placeholder tokens. Real values get stored in the DataVault.
 *
 * Detection layers:
 * 1. Input type heuristics (type="email", type="password", etc.)
 * 2. Label heuristics (label contains "name", "phone", etc.)
 * 3. Regex patterns (email, phone, SSN, credit card, etc.)
 * 4. Future: NER model via Transformers.js for contextual detection
 */

// ── PII Categories ──

const PII_CATEGORIES = {
  EMAIL: {
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    inputTypes: ['email'],
    labelKeywords: ['email', 'e-mail', 'mail']
  },
  PHONE: {
    regex: /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g,
    inputTypes: ['tel'],
    labelKeywords: ['phone', 'mobile', 'cell', 'telephone', 'contact number']
  },
  NAME: {
    regex: null, // Names are too ambiguous for regex — rely on label heuristics + NER
    inputTypes: [],
    labelKeywords: ['name', 'full name', 'first name', 'last name', 'surname', 'given name']
  },
  PASSWORD: {
    regex: null, // Never read password values
    inputTypes: ['password'],
    labelKeywords: ['password', 'passwd', 'pin', 'passcode']
  },
  SSN: {
    regex: /\b\d{3}-?\d{2}-?\d{4}\b/g,
    inputTypes: [],
    labelKeywords: ['ssn', 'social security', 'tax id', 'sin']
  },
  CREDIT_CARD: {
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    inputTypes: [],
    labelKeywords: ['card number', 'credit card', 'debit card', 'card no']
  },
  ADDRESS: {
    regex: null,
    inputTypes: [],
    labelKeywords: ['address', 'street', 'city', 'zip', 'postal', 'pincode', 'pin code']
  },
  AADHAAR: {
    regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    inputTypes: [],
    labelKeywords: ['aadhaar', 'aadhar', 'uid']
  },
  PAN: {
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    inputTypes: [],
    labelKeywords: ['pan', 'pan number', 'pan card']
  }
};

/**
 * Detect PII in extracted DOM elements and tokenize values.
 *
 * @param {Array} rawElements — from perception.js (with current_value, label, type)
 * @param {DataVault} vault — local-only token store
 * @returns {{ elements: Array, tokens: string[] }}
 */
export function detectAndTokenize(rawElements, vault) {
  const sanitizedElements = [];

  for (const el of rawElements) {
    const sanitized = { ...el };
    delete sanitized._node;      // never serialize DOM refs
    delete sanitized.rect;       // optional: include if needed by server

    // Detect PII category for this element
    const category = detectCategory(el);

    if (category === 'PASSWORD') {
      // Passwords are never copied into the vault, even if the field is filled.
      sanitized.current_value_token = el.current_value ? '[REDACTED]' : null;
    } else if (category && el.current_value) {
      // Tokenize: store real value in vault, replace with token
      const token = vault.store(category, el.current_value);
      sanitized.current_value_token = `[${token}]`;
    } else {
      // No PII detected — check value with regex as fallback
      if (el.current_value) {
        const regexResult = regexScan(el.current_value);
        if (regexResult) {
          const token = vault.store(regexResult.category, el.current_value);
          sanitized.current_value_token = `[${token}]`;
        } else {
          sanitized.current_value_token = null;
        }
      } else {
        sanitized.current_value_token = null;
      }
    }

    // Remove raw value — NEVER include in sanitized output
    delete sanitized.current_value;

    sanitizedElements.push(sanitized);
  }

  return {
    elements: sanitizedElements,
    tokens: Object.keys(vault.getTokenMap())
  };
}

// ── Detection Logic ──

/**
 * Determine PII category from input type and label heuristics.
 */
function detectCategory(el) {
  const inputType = (el.type || '').toLowerCase();
  const label = (el.label || '').toLowerCase();

  for (const [category, rules] of Object.entries(PII_CATEGORIES)) {
    // Match by input type
    if (rules.inputTypes.includes(inputType)) {
      return category;
    }
    // Match by label keywords
    if (rules.labelKeywords.some(kw => label.includes(kw))) {
      return category;
    }
  }

  return null;
}

/**
 * Fallback: scan a value string against all regex patterns.
 * Returns { category, match } or null.
 */
function regexScan(value) {
  for (const [category, rules] of Object.entries(PII_CATEGORIES)) {
    if (!rules.regex) continue;
    rules.regex.lastIndex = 0; // reset stateful regex
    if (rules.regex.test(value)) {
      return { category, match: value };
    }
  }
  return null;
}

/**
 * Sanitize a text string by replacing all detected PII with tokens.
 * Used for vision_summary and other free-text fields.
 *
 * @param {string} text
 * @param {DataVault} vault
 * @returns {string}
 */
export function sanitizeText(text, vault) {
  let result = text;

  for (const [category, rules] of Object.entries(PII_CATEGORIES)) {
    if (!rules.regex) continue;
    rules.regex.lastIndex = 0;
    result = result.replace(rules.regex, (match) => {
      const token = vault.store(category, match);
      return `[${token}]`;
    });
  }

  return result;
}
