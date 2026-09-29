/**
 * Mintx — Service Worker (Background)
 *
 * Orchestrates the observe-plan-act loop:
 * 1. Receive user intent from popup
 * 2. Capture screenshot + tell content script to extract DOM + PII
 * 3. Run vision model on screenshot (captioning + face detection)
 * 4. Apply visual redactions to screenshot
 * 5. Build SanitizedContext with redacted screenshot
 * 6. Send to server, receive ActionPlan
 * 7. Forward actions to content script for execution
 * 8. Receive ActionResult, decide: loop or done
 */

import { buildSanitizedContext } from '../core/context-builder.js';
import { captureVisibleTab, dataUrlToImageData, canvasToDataUrl } from '../core/screenshot.js';
import { initVisionModel, generateVisionSummary, detectVisualPII, isVisionReady } from '../core/vision-model.js';
import { applyRedactions } from '../core/redactor.js';

const SERVER_URL = 'http://localhost:8000';
let visionInitialized = false;

// ── Message Router ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_TASK') {
    handleTask(msg.payload.userIntent);
    sendResponse({ status: 'started' });
  }
  if (msg.type === 'INIT_VISION') {
    initVision();
    sendResponse({ status: 'initializing' });
  }
  return true;
});

// ── Vision Model Init (lazy, first use) ──

async function initVision() {
  if (visionInitialized) return;
  broadcast('AGENT_LOG', { message: 'Loading vision models (first-time download)...', level: 'info' });
  broadcast('AGENT_STATUS', { text: 'Loading AI', state: 'running' });

  try {
    await initVisionModel((progress) => {
      if (progress.status === 'progress' && progress.progress) {
        broadcast('AGENT_LOG', {
          message: `Downloading ${progress.file}: ${Math.round(progress.progress)}%`,
          level: 'info'
        });
      }
    });
    visionInitialized = true;
    broadcast('AGENT_LOG', { message: 'Vision models loaded ✓', level: 'success' });
    broadcast('AGENT_STATUS', { text: 'Ready', state: 'success' });
  } catch (err) {
    broadcast('AGENT_LOG', { message: `Vision model failed: ${err.message}`, level: 'error' });
    broadcast('AGENT_STATUS', { text: 'Vision Error', state: 'error' });
  }
}

// ── Agent Loop ──

async function handleTask(userIntent) {
  const actionHistory = [];
  let taskComplete = false;
  let iteration = 0;
  const MAX_ITERATIONS = 10;

  broadcast('AGENT_STATUS', { text: 'Running', state: 'running' });
  broadcast('AGENT_LOG', { message: `Starting task: "${userIntent}"`, level: 'action' });

  // Ensure vision models are loaded
  if (!visionInitialized) {
    await initVision();
  }

  while (!taskComplete && iteration < MAX_ITERATIONS) {
    iteration++;
    broadcast('AGENT_LOG', { message: `── Loop ${iteration} ──`, level: 'info' });

    try {
      const tab = await getActiveTab();

      // Step 1: Capture screenshot
      broadcast('AGENT_LOG', { message: 'Capturing screenshot...', level: 'info' });
      let screenshotDataUrl = null;
      let redactedScreenshot = null;

      try {
        screenshotDataUrl = await captureVisibleTab(tab.id);
      } catch (err) {
        broadcast('AGENT_LOG', { message: `Screenshot capture failed: ${err.message}`, level: 'warn' });
      }

      // Step 2: DOM observation from content script
      const observation = await sendToContentScript(tab.id, {
        type: 'OBSERVE',
        payload: { userIntent }
      });

      if (!observation) {
        broadcast('AGENT_LOG', { message: 'No observation returned from page', level: 'error' });
        break;
      }

      if (!observation.piiScanReady) {
        throw new Error('Local PII model is unavailable; refusing to send page context.');
      }

      // Step 3: Vision processing on screenshot
      let visionSummary = observation.visionSummary; // DOM-based fallback

      if (screenshotDataUrl) {
        // 3a: Generate vision summary (image captioning)
        if (isVisionReady()) {
          broadcast('AGENT_LOG', { message: 'Running vision model...', level: 'info' });
          const aiSummary = await generateVisionSummary(screenshotDataUrl);
          if (aiSummary) {
            const sanitized = await sendToContentScript(tab.id, {
              type: 'SANITIZE_TEXT',
              payload: { text: `${aiSummary}. DOM context: ${observation.visionSummary}` }
            });
            visionSummary = sanitized?.text || observation.visionSummary;
          }
        }

        // 3b: Detect visual PII (faces)
        broadcast('AGENT_LOG', { message: 'Scanning for visual PII...', level: 'pii' });
        const { imageData, canvas, ctx, width, height, scale } = await dataUrlToImageData(screenshotDataUrl);

        // Get face regions from vision model
        const visualPIIRegions = isVisionReady()
          ? await detectVisualPII(screenshotDataUrl, width, height)
          : [];

        // Get DOM-based PII regions from content script observation
        const domPIIRegions = observation.piiRegions || [];

        // Combine all redaction regions
        const allRegions = [...visualPIIRegions, ...domPIIRegions];

        if (allRegions.length > 0) {
          broadcast('AGENT_LOG', {
            message: `Redacting ${allRegions.length} PII regions (${visualPIIRegions.length} visual, ${domPIIRegions.length} DOM)`,
            level: 'pii'
          });

          // Apply redactions
          applyRedactions(canvas, ctx, allRegions);
          redactedScreenshot = await canvasToDataUrl(canvas);
        } else {
          broadcast('AGENT_LOG', { message: 'No visual PII detected', level: 'info' });
          redactedScreenshot = screenshotDataUrl; // no redactions needed
        }
      }

      // Step 4: Build sanitized context
      const context = buildSanitizedContext({
        userIntent: observation.sanitizedUserIntent,
        pageDomain: new URL(tab.url).hostname,
        domElements: observation.domElements,
        visionSummary,
        availableTokens: observation.availableTokens,
        actionHistory,
        screenshotBase64: redactedScreenshot || null
      });

      broadcast('AGENT_LOG', {
        message: `Context: ${context.dom_elements.length} elements, ${context.available_tokens.length} tokens${redactedScreenshot ? ', +screenshot' : ''}`,
        level: 'info'
      });

      // Step 5: Send to server
      broadcast('AGENT_LOG', { message: 'Sending sanitized context to server...', level: 'action' });
      const plan = await sendToServer(context);

      if (!plan || !plan.actions) {
        broadcast('AGENT_LOG', { message: 'Server returned no actions', level: 'warn' });
        break;
      }

      if (plan.request_id !== context.request_id) {
        throw new Error('Server returned an action plan for a different request.');
      }

      broadcast('AGENT_LOG', {
        message: `Server plan: "${plan.reasoning}" (${plan.actions.length} actions)`,
        level: 'action'
      });

      // Step 6: Execute actions via content script
      for (const action of plan.actions) {
        broadcast('AGENT_LOG', {
          message: `Executing: ${action.type} → ${action.target_element_id} ${action.value ? `(${action.value})` : ''}`,
          level: 'action'
        });

        const result = await sendToContentScript(tab.id, {
          type: 'EXECUTE_ACTION',
          payload: action
        });

        actionHistory.push({
          action_id: action.action_id,
          type: action.type,
          target: action.target_element_id,
          result: result?.status || 'unknown'
        });

        if (result?.status === 'success') {
          broadcast('AGENT_LOG', { message: `✓ ${action.action_id} succeeded`, level: 'success' });
        } else {
          broadcast('AGENT_LOG', {
            message: `✗ ${action.action_id} failed: ${result?.error || 'unknown'}`,
            level: 'error'
          });
        }
      }

      taskComplete = plan.task_complete === true;

    } catch (err) {
      broadcast('AGENT_LOG', { message: `Loop error: ${err.message}`, level: 'error' });
      break;
    }
  }

  const finalStatus = taskComplete ? 'Done' : (iteration >= MAX_ITERATIONS ? 'Max loops' : 'Stopped');
  const finalState = taskComplete ? 'success' : 'error';
  broadcast('AGENT_STATUS', { text: finalStatus, state: finalState });
  broadcast('AGENT_LOG', { message: `Agent finished: ${finalStatus}`, level: taskComplete ? 'success' : 'warn' });
}

// ── Server Communication ──

async function sendToServer(sanitizedContext) {
  const res = await fetch(`${SERVER_URL}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedContext)
  });

  if (!res.ok) {
    throw new Error(`Server responded ${res.status}`);
  }

  return res.json();
}

// ── Helpers ──

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response);
    });
  });
}

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // popup might be closed — that's fine
  });
}
