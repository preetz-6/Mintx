/**
 * Mintx — Executor
 *
 * Executes browser actions (click, type, scroll, navigate, wait)
 * on the actual DOM. Resolves token placeholders via DataVault
 * immediately before execution.
 *
 * Returns ActionResult for the observe-act-observe loop.
 */

export class Executor {
  /**
   * @param {import('./data-vault.js').DataVault} vault
   */
  constructor(vault) {
    this.vault = vault;
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
        case 'click':
          await this._click(action);
          break;
        case 'type':
          await this._type(action);
          break;
        case 'scroll':
          await this._scroll(action);
          break;
        case 'navigate':
          await this._navigate(action);
          break;
        case 'select':
          await this._select(action);
          break;
        case 'wait':
          await this._wait(action);
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      // Brief wait for DOM to settle
      await sleep(150);

      const endDom = document.body.innerHTML.length;

      return {
        action_id: action.action_id,
        status: 'success',
        dom_changed: endDom !== startDom,
        error: null
      };

    } catch (err) {
      return {
        action_id: action.action_id,
        status: 'error',
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

    // Resolve token → real value from vault
    let value = action.value || '';
    if (/^\[.+\]$/.test(value)) {
      const resolved = this.vault.resolve(value);
      if (resolved === null) {
        throw new Error(`Token ${value} not found in vault`);
      }
      value = resolved;
    }

    // Clear existing value
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // Type character by character (more natural, triggers frameworks)
    for (const char of value) {
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await sleep(20);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async _scroll(action) {
    const amount = action.value || 300;
    const direction = action.direction || 'down';

    if (action.target_element_id) {
      const el = this._findElement(action.target_element_id);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollBy({
        top: direction === 'up' ? -amount : amount,
        behavior: 'smooth'
      });
    }
  }

  async _select(action) {
    const el = this._findElement(action.target_element_id);
    if (el.tagName.toLowerCase() !== 'select') {
      throw new Error('Target is not a select element');
    }

    let value = action.value || '';
    if (/^\[.+\]$/.test(value)) {
      value = this.vault.resolve(value) || value;
    }

    // Find matching option
    const option = Array.from(el.options).find(
      opt => opt.value === value || opt.textContent.trim() === value
    );

    if (!option) {
      throw new Error(`No matching option for "${value}"`);
    }

    el.value = option.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async _navigate(action) {
    window.location.href = action.value;
  }

  async _wait(action) {
    const ms = parseInt(action.value, 10) || 1000;
    await sleep(Math.min(ms, 5000)); // cap at 5s
  }

  // ── Helpers ──

  _findElement(elementId) {
    const el = document.querySelector(`[data-mintx-id="${elementId}"]`);
    if (!el) {
      throw new Error(`Element ${elementId} not found in DOM`);
    }
    return el;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
