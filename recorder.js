const { EventEmitter } = require('node:events');
const { normalizeTranscriptEvent } = require('./transcript');

function isGoogleMeet(window) {
  const platform = window?.platform?.replaceAll('_', '-');
  return ['google-meet', 'google-meet-chromium', 'google-meet-safari'].includes(platform);
}

async function createUploadToken(apiUrl, apiKey) {
  const response = await fetch(new URL('/api/v1/sdk_upload/', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: { mode: 'prioritize_low_latency', language_code: 'en' },
          },
          diarization: { use_separate_streams_when_available: true },
        },
        realtime_endpoints: [{ type: 'desktop_sdk_callback', events: ['transcript.data'] }],
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to create SDK upload (${response.status}): ${await response.text()}`);
  }
  const { upload_token: uploadToken } = await response.json();
  if (!uploadToken) throw new Error('SDK upload response did not include an upload token.');
  return uploadToken;
}

function createRecorder({ sdk, apiUrl, apiKey, getUploadToken = createUploadToken }) {
  const events = new EventEmitter();
  const meetings = new Map();
  const transcript = [];
  let activeRecording = null;
  let session = null;
  let ready = false;
  let status = 'idle';
  let error = null;
  let closing = false;

  const currentMeeting = () => meetings.values().next().value || null;
  const getState = () => ({
    ready,
    status,
    error,
    apiConfigured: Boolean(apiKey?.trim()),
    meetingDetected: meetings.size > 0,
    meeting: currentMeeting(),
    transcriptCount: transcript.length,
  });
  const getSnapshot = () => ({ state: getState(), transcript: [...transcript] });
  const emitState = () => events.emit('state', getState());

  function setError(cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    emitState();
  }

  function onMeetingDetected({ window }) {
    if (!isGoogleMeet(window)) return;
    meetings.set(window.id, window);
    error = null;
    emitState();
  }

  function onMeetingUpdated({ window }) {
    const previous = meetings.get(window.id);
    if (!previous) return;
    meetings.set(window.id, { ...previous, ...window });
    emitState();
  }

  function onMeetingClosed({ window }) {
    meetings.delete(window.id);
    if (activeRecording?.window.id === window.id) {
      activeRecording.closed = true;
      status = 'stopping';
    }
    emitState();
  }

  function onRecordingStarted({ window }) {
    if (activeRecording?.window.id !== window.id) return;
    status = 'recording';
    error = null;
    emitState();
  }

  function onRecordingEnded({ window }) {
    if (activeRecording?.window.id !== window.id) return;
    activeRecording = null;
    status = 'idle';
    error = null;
    emitState();
  }

  function onTranscript(event) {
    if (event.event !== 'transcript.data' || event.window?.id !== session?.meeting.id) return;
    const entry = normalizeTranscriptEvent(event);
    if (!entry) return;
    transcript.push(entry);
    events.emit('transcript', entry);
    emitState();
  }

  const listeners = {
    'meeting-detected': onMeetingDetected,
    'meeting-updated': onMeetingUpdated,
    'meeting-closed': onMeetingClosed,
    'recording-started': onRecordingStarted,
    'recording-ended': onRecordingEnded,
    'realtime-event': onTranscript,
    error: (sdkError) => setError(sdkError?.message || 'The Desktop SDK reported an error.'),
  };
  for (const [event, listener] of Object.entries(listeners)) sdk.addEventListener(event, listener);

  async function initialize() {
    try {
      await sdk.init({
        apiUrl,
        acquirePermissionsOnStartup: ['accessibility', 'microphone', 'screen-capture'],
      });
      ready = true;
      error = null;
      emitState();
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }

  async function startRecording() {
    const meeting = currentMeeting();
    if (!ready) throw new Error('The Desktop SDK is not ready yet.');
    if (!apiKey?.trim()) throw new Error('Set RECALL_API_KEY in .env.local before recording.');
    if (!meeting) throw new Error('No Google Meet meeting is detected.');
    if (activeRecording) throw new Error('A recording is already active.');

    status = 'starting';
    error = null;
    transcript.length = 0;
    session = { meeting, startedAt: new Date().toISOString() };
    activeRecording = { window: meeting, closed: false };
    events.emit('reset');
    emitState();

    try {
      const uploadToken = await getUploadToken(apiUrl, apiKey);
      if (!meetings.has(meeting.id)) throw new Error('The meeting closed before recording could start.');
      await sdk.startRecording({ windowId: meeting.id, uploadToken, rawMediaEnabled: true });
      if (activeRecording?.window.id === meeting.id && status === 'starting') {
        status = 'recording';
        emitState();
      }
    } catch (cause) {
      activeRecording = null;
      status = 'idle';
      setError(cause);
      throw cause;
    }
  }

  function waitForRecordingEnd(recording) {
    return new Promise((resolve, reject) => {
      let timer;
      const onEnded = ({ window }) => {
        if (window.id !== recording.window.id) return;
        clearTimeout(timer);
        sdk.removeEventListener('recording-ended', onEnded);
        resolve();
      };
      sdk.addEventListener('recording-ended', onEnded);
      timer = setTimeout(() => {
        sdk.removeEventListener('recording-ended', onEnded);
        reject(new Error('Recording did not finish within 30 seconds; upload completion is unconfirmed.'));
      }, 30000);

      if (!recording.closed) {
        sdk.stopRecording({ windowId: recording.window.id }).catch((cause) => {
          clearTimeout(timer);
          sdk.removeEventListener('recording-ended', onEnded);
          reject(cause);
        });
      }
    });
  }

  async function stopRecording() {
    if (!activeRecording || !['starting', 'recording'].includes(status)) {
      throw new Error('No recording is active.');
    }
    if (activeRecording.stopPromise) return activeRecording.stopPromise;

    const recording = activeRecording;
    status = 'stopping';
    error = null;
    emitState();
    recording.stopPromise = waitForRecordingEnd(recording);
    try {
      await recording.stopPromise;
    } catch (cause) {
      if (activeRecording === recording) {
        recording.stopPromise = null;
        status = 'recording';
        setError(cause);
      }
      throw cause;
    }
  }

  function getExportData() {
    return {
      recording_started_at: session?.startedAt || null,
      meeting: session?.meeting || null,
      transcript: [...transcript],
    };
  }

  async function close() {
    if (closing) return;
    closing = true;
    if (activeRecording) {
      try {
        if (activeRecording.stopPromise) await activeRecording.stopPromise;
        else if (['starting', 'recording'].includes(status)) await stopRecording();
        else await waitForRecordingEnd(activeRecording);
      } catch (cause) {
        console.error('Failed to finish recording:', cause);
      }
    }
    for (const [event, listener] of Object.entries(listeners)) sdk.removeEventListener(event, listener);
    await sdk.shutdown();
  }

  return {
    events,
    initialize,
    startRecording,
    stopRecording,
    getSnapshot,
    getExportData,
    close,
  };
}

module.exports = { createRecorder, createUploadToken, isGoogleMeet };
