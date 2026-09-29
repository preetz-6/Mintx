/**
 * Mintx — Perception Module
 *
 * Extracts interactive DOM elements into a structured format
 * suitable for the SanitizedContext contract.
 *
 * Future: integrate ViT model for visual screen understanding.
 */

const INTERACTIVE_SELECTORS = [
  'input', 'textarea', 'select', 'button',
  '[role="button"]', '[role="textbox"]', '[role="checkbox"]',
  '[role="radio"]', '[role="link"]', '[role="menuitem"]',
  '[contenteditable="true"]',
  'a[href]',
  '[type="submit"]'
];

let elementIdCounter = 0;

/**
 * Extract interactive DOM elements from the page.
 * Returns raw elements (values NOT yet tokenized — that's pii-detector's job).
 *
 * @param {Document} doc
 * @returns {Array<Object>} raw element descriptors
 */
export function extractDomElements(doc) {
  const selector = INTERACTIVE_SELECTORS.join(', ');
  const nodes = doc.querySelectorAll(selector);
  const elements = [];

  for (const node of nodes) {
    // Skip hidden elements
    if (isHidden(node)) continue;

    const el = {
      element_id: node.dataset.mintxId || assignId(node),
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute('type') || null,
      role: node.getAttribute('role') || getImplicitRole(node),
      label: getLabel(node, doc),
      placeholder: node.getAttribute('placeholder') || null,
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

// ── Helpers ──

function assignId(node) {
  const id = `el_${++elementIdCounter}`;
  node.dataset.mintxId = id;
  return id;
}

function isHidden(node) {
  const style = getComputedStyle(node);
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    node.offsetWidth === 0 && node.offsetHeight === 0
  );
}

function getImplicitRole(node) {
  const tag = node.tagName.toLowerCase();
  const type = (node.getAttribute('type') || '').toLowerCase();

  const roleMap = {
    'a': 'link',
    'button': 'button',
    'select': 'listbox',
    'textarea': 'textbox',
  };

  if (tag === 'input') {
    const inputRoles = {
      'text': 'textbox', 'email': 'textbox', 'tel': 'textbox',
      'url': 'textbox', 'search': 'searchbox', 'password': 'textbox',
      'number': 'spinbutton', 'checkbox': 'checkbox', 'radio': 'radio',
      'submit': 'button', 'reset': 'button', 'button': 'button',
    };
    return inputRoles[type] || 'textbox';
  }

  return roleMap[tag] || null;
}

function getLabel(node, doc) {
  // Explicit label via for/id
  if (node.id) {
    const label = doc.querySelector(`label[for="${node.id}"]`);
    if (label) return label.textContent.trim();
  }

  // Wrapping label
  const parentLabel = node.closest('label');
  if (parentLabel) {
    // Get label text without the input's own text
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, textarea, select, button').forEach(n => n.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // aria-label
  const ariaLabel = node.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = node.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = doc.getElementById(labelledBy);
    if (ref) return ref.textContent.trim();
  }

  // Button/link inner text
  if (['button', 'a'].includes(node.tagName.toLowerCase())) {
    return node.textContent.trim().substring(0, 80) || null;
  }

  return null;
}

function getCurrentValue(node) {
  const tag = node.tagName.toLowerCase();
  if (tag === 'select') {
    const selected = node.options[node.selectedIndex];
    return selected ? selected.textContent.trim() : null;
  }
  if (tag === 'input' || tag === 'textarea') {
    return node.value || null;
  }
  return null;
}

function getRect(node) {
  const r = node.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}
