/**
 * Mintx — Popup Controller
 * Handles user task input, communicates with the service worker,
 * and renders the agent log.
 */

const taskInput = document.getElementById('task-input');
const runBtn = document.getElementById('run-btn');
const statusBadge = document.getElementById('status-badge');
const agentLog = document.getElementById('agent-log');

// ── Logging ──

function log(message, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
  entry.textContent = `[${ts}] ${message}`;
  agentLog.appendChild(entry);
  agentLog.scrollTop = agentLog.scrollHeight;
}

function setStatus(text, state = '') {
  statusBadge.textContent = text;
  statusBadge.className = `status-badge ${state}`;
}

// ── Run Task ──

async function runTask() {
  const intent = taskInput.value.trim();
  if (!intent) return;

  runBtn.disabled = true;
  setStatus('Running', 'running');
  log(`Task: "${intent}"`, 'action');

  try {
    // Send task to service worker which orchestrates the agent loop
    const response = await chrome.runtime.sendMessage({
      type: 'START_TASK',
      payload: { userIntent: intent }
    });

    if (response?.error) {
      log(`Error: ${response.error}`, 'error');
      setStatus('Error', 'error');
    }
  } catch (err) {
    log(`Failed to start task: ${err.message}`, 'error');
    setStatus('Error', 'error');
  }

  runBtn.disabled = false;
}

runBtn.addEventListener('click', runTask);
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runTask();
  }
});

// ── Listen for log messages from service worker ──

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AGENT_LOG') {
    log(msg.payload.message, msg.payload.level || 'info');
  }
  if (msg.type === 'AGENT_STATUS') {
    setStatus(msg.payload.text, msg.payload.state);
  }
});
