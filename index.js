const RecallAiSdk = require('@recallai/desktop-sdk');

const apiUrl = process.env.RECALL_API_URL || 'https://us-west-2.recall.ai';
const meetings = new Map();
const recordings = new Map();
const transcriptsByWindow = new Map();
let stopping = false;

async function createUploadToken() {
  const response = await fetch(new URL('/api/v1/sdk_upload/', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: process.env.RECALL_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: 'prioritize_low_latency',
              language_code: 'en',
            },
          },
          diarization: {
            use_separate_streams_when_available: true,
          },
        },
        realtime_endpoints: [
          {
            type: 'desktop_sdk_callback',
            events: ['transcript.data'],
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to create SDK upload (${response.status}): ${await response.text()}`);
  }

  const { upload_token } = await response.json();
  if (!upload_token) throw new Error('SDK upload response did not include an upload token.');
  return upload_token;
}

function isGoogleMeet(window) {
  const platform = window?.platform?.replaceAll('_', '-');
  return ['google-meet', 'google-meet-chromium', 'google-meet-safari'].includes(platform);
}

async function recordMeeting(window) {
  if (stopping || recordings.has(window.id)) return;
  if (!isGoogleMeet(window)) return;

  const recording = { window };
  recordings.set(window.id, recording);

  try {
    const uploadToken = await createUploadToken();
    // The meeting may close while the upload token request is in flight.
    if (stopping || recordings.get(window.id) !== recording) return;
    if (!isGoogleMeet(meetings.get(window.id))) {
      recordings.delete(window.id);
      return;
    }

    recording.startPromise = RecallAiSdk.startRecording({ windowId: window.id, uploadToken, rawMediaEnabled: true });
    await recording.startPromise;
    console.log('Recording started:', window.id);
  } catch (error) {
    if (recordings.get(window.id) === recording) recordings.delete(window.id);
    console.error('Failed to start recording:', window.id, error);
  }
}

RecallAiSdk.addEventListener('meeting-detected', ({ window }) => {
  meetings.set(window.id, window);
  console.log('Meeting detected:', window);
  return recordMeeting(window);
});

RecallAiSdk.addEventListener('meeting-updated', ({ window }) => {
  const previous = meetings.get(window.id);
  if (!previous) return;

  const updated = { ...previous, ...window };
  console.log('Meeting updated:', updated);
  meetings.set(window.id, updated);
  return recordMeeting(updated);
});

RecallAiSdk.addEventListener('realtime-event', (event) => {
  if (event.event !== 'transcript.data') return;

  const windowId = event.window.id;
  if (!transcriptsByWindow.has(windowId)) transcriptsByWindow.set(windowId, []);
  transcriptsByWindow.get(windowId).push(event);
  console.log('transcript.data:', JSON.stringify(event));
});

RecallAiSdk.addEventListener('meeting-closed', ({ window }) => {
  meetings.delete(window.id);
  const recording = recordings.get(window.id);
  if (recording?.startPromise) recording.closed = true;
  else recordings.delete(window.id);
  console.log('Meeting closed:', window);
});

RecallAiSdk.addEventListener('recording-ended', ({ window }) => {
  meetings.delete(window.id);
  recordings.delete(window.id);
  console.log('Recording ended:', window.id);
});

RecallAiSdk.addEventListener('permissions-granted', () => {
  console.log('Recording permissions granted.');
});

RecallAiSdk.addEventListener('permission-status', ({ permission, status }) => {
  if (permission === 'browser-automation') console.log(`browser-automation: ${status}`);
});

RecallAiSdk.addEventListener('error', (error) => {
  console.error('Desktop SDK error:', error);
});

async function finishRecording(windowId, recording) {
  let onEnded;
  let timeout;
  let cancelled = false;
  const ended = new Promise((resolve) => {
    onEnded = ({ window }) => { if (window.id === windowId) resolve(); };
    RecallAiSdk.addEventListener('recording-ended', onEnded);
  });

  try {
    await Promise.race([
      (async () => {
        await recording.startPromise;
        if (cancelled || recordings.get(windowId) !== recording) return;
        if (!recording.closed) await RecallAiSdk.stopRecording({ windowId });
        await ended;
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Recording ${windowId} did not finish within 30 seconds; upload completion is unconfirmed.`)), 30000);
      }),
    ]);
  } finally {
    cancelled = true;
    clearTimeout(timeout);
    RecallAiSdk.removeEventListener('recording-ended', onEnded);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('Stopping recordings and waiting for completion...');

  // SDK shutdown exits immediately; recording-ended confirms recording cleanup first.
  const results = await Promise.allSettled(
    [...recordings].filter(([, recording]) => recording.startPromise)
      .map(([windowId, recording]) => finishRecording(windowId, recording)),
  );
  let exitCode = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Failed to finish recording:', result.reason);
      exitCode = 1;
    }
  }

  try {
    await RecallAiSdk.shutdown();
    process.exit(exitCode);
  } catch (error) {
    console.error('Failed to stop the Desktop SDK:', error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (process.stdin.isTTY) {
  // Intercept Ctrl+C so the terminal does not also kill the SDK subprocess.
  const wasRaw = Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data) => { if (data.includes(3)) void shutdown(); });
  process.on('exit', () => process.stdin.setRawMode(wasRaw));
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Google Meet Raw Media setup requires an Apple Silicon Mac running macOS 13 or later.');
  }

  if (!process.env.RECALL_API_KEY?.trim()) {
    throw new Error('Set RECALL_API_KEY in .env.local before starting.');
  }

  await RecallAiSdk.init({
    apiUrl,
    acquirePermissionsOnStartup: [], // We can automatically ask for perms on startup, but it's better to request them with an info modal
  });
  if (stopping) return;

  console.log('Configure browser automation before joining a meeting. macOS may ask to control your default browser, which may restart once.');
  await RecallAiSdk.requestPermission('browser-automation');
  console.log('If prompted, approve then wait for "browser-automation: granted", then press Ctrl+C and run npm start.');

  if (process.platform === 'darwin') {
    for (const permission of ['accessibility', 'microphone', 'screen-capture']) {
      if (stopping) return;
      await RecallAiSdk.requestPermission(permission);
    }
  }

  if (!stopping) console.log('Desktop SDK running. Only Google Meet meetings will be recorded and transcribed. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Failed to start the Desktop SDK:', error);
  process.exit(1);
});
