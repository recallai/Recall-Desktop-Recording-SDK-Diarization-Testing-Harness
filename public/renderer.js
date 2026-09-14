const elements = Object.fromEntries(
  [
    'start', 'stop', 'spinner', 'stop-label', 'export', 'permissions', 'permission-status',
    'dot', 'meeting', 'phase', 'error', 'transcript', 'count',
  ]
    .map((id) => [id, document.getElementById(id)]),
);
let state = {
  ready: false,
  status: 'idle',
  apiConfigured: false,
  meetingDetected: false,
  transcriptCount: 0,
  browserAutomationStatus: 'unknown',
  permissionRequestPending: false,
};

function permissionMessage() {
  if (!state.ready) return 'Initialize the recorder to check browser access.';
  if (state.permissionRequestPending || state.browserAutomationStatus === 'requesting') {
    return 'Follow the macOS prompt. Your default browser may restart once.';
  }
  if (state.browserAutomationStatus === 'granted') return 'Browser access is enabled.';
  if (state.browserAutomationStatus === 'requested') {
    return 'Permission requested. Approve the macOS prompt, then wait for access to be enabled.';
  }
  if (state.browserAutomationStatus === 'denied') {
    return 'Access was not granted. Check macOS System Settings, then try again.';
  }
  return 'Required once for Google Meet detection. Your default browser may restart.';
}

function renderState(next) {
  state = next;
  const stopping = state.status === 'stopping';
  const configurationError = state.apiConfigured ? null : 'Set RECALL_API_KEY in .env.local before recording.';
  const visibleError = state.error || configurationError;

  elements.meeting.textContent = state.meetingDetected
    ? `Meeting detected${state.meeting?.title ? `: ${state.meeting.title}` : ''}`
    : 'No meeting detected';
  elements.dot.classList.toggle('detected', state.meetingDetected);
  elements.phase.textContent = state.ready ? state.status : (state.error ? 'Unavailable' : 'Initializing');
  elements.start.disabled = !state.ready || !state.apiConfigured || !state.meetingDetected || state.status !== 'idle';
  elements.stop.disabled = state.status !== 'recording';
  elements.spinner.hidden = !stopping;
  elements['stop-label'].textContent = stopping ? 'Stopping…' : 'Stop recording';
  elements.export.disabled = state.transcriptCount === 0;
  const permissionGranted = state.browserAutomationStatus === 'granted';
  elements.permissions.disabled = !state.ready || state.status !== 'idle'
    || state.permissionRequestPending || permissionGranted;
  elements.permissions.textContent = state.permissionRequestPending
    ? 'Requesting access…'
    : (permissionGranted ? 'Access enabled' : 'Enable access');
  elements['permission-status'].textContent = permissionMessage();
  elements.error.textContent = visibleError || '';
  elements.error.hidden = !visibleError;
  elements.count.textContent = `${state.transcriptCount} utterance${state.transcriptCount === 1 ? '' : 's'}`;
}

function resetTranscript(message = 'Transcript will appear here while recording.') {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = message;
  elements.transcript.replaceChildren(empty);
}

function appendTranscript(entry) {
  if (elements.transcript.querySelector('.empty')) elements.transcript.replaceChildren();
  const article = document.createElement('article');
  const speaker = document.createElement('strong');
  const text = document.createElement('p');
  speaker.textContent = entry.speaker;
  text.textContent = entry.text;
  article.append(speaker, text);
  elements.transcript.append(article);
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

async function run(action) {
  const result = await window.recorder[action]();
  if (!result.ok) renderState({ ...state, error: result.error || `${action} failed.` });
}

elements.start.addEventListener('click', () => run('start'));
elements.stop.addEventListener('click', () => run('stop'));
elements.export.addEventListener('click', () => run('export'));
elements.permissions.addEventListener('click', () => run('initializePermissions'));
window.recorder.onState(renderState);
window.recorder.onTranscript(appendTranscript);
window.recorder.onReset(() => resetTranscript('Listening for speech…'));

window.recorder.getSnapshot().then((snapshot) => {
  resetTranscript();
  snapshot.transcript.forEach(appendTranscript);
  renderState(snapshot.state);
});
