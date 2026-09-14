# Recall.ai Google Meet Raw Media Demo

A minimal demo of Google Meets Raw Media using `@recallai/desktop-sdk`.

## Setup

1. Use Node.js 22 or newer and install the dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `RECALL_API_KEY` and `RECALL_API_URL` in `.env.local` for your Recall.ai account and [region](https://docs.recall.ai/docs/desktop-sdk#starting-the-sdk). The API URL defaults to `https://us-west-2.recall.ai`.
4. Complete the Google Meet Raw Media setup below, then run `npm start`.

`npm start` loads `.env.local` and initializes the SDK. On macOS, grant the accessibility, microphone, and screen capture permissions when prompted. Only detected Google Meet meetings get a new SDK upload token and start recording automatically; other meeting platforms are ignored. Press Ctrl+C to shut down when needed.

Each upload sets `recording_config.transcript.diarization.use_separate_streams_when_available: true`, enables [Recall.ai real-time transcription](https://docs.recall.ai/docs/dsdk-realtime-transcription) in English with `prioritize_low_latency`, and sends `transcript.data` through `desktop_sdk_callback`. Each complete event is logged as JSON and appended to `transcriptsByWindow`, a `Map` keyed by the SDK window ID in `index.js`. Events remain in memory after the meeting closes and are lost when the process exits.

Ctrl+C stops active recordings and waits for `recording-ended` before shutting down the SDK. Recordings that are already closing are allowed to finish. If completion is not confirmed within 30 seconds, the app will force shutdown.

## Google Meet Raw Media setup

Separate participant audio requires [Desktop SDK Raw Media](https://docs.recall.ai/docs/desktop-recording-sdk-raw-media). Enable Raw Media for the Recall.ai workspace associated with your API key through your Recall.ai account team. The app cannot enable this workspace capability itself.

Use an Apple Silicon Mac running macOS 13 or later. Set a supported browser (Chrome, Arc, Brave, Comet, or Dia) as your default browser, then run this before joining a meeting:

```sh
npm run setup:google-meet
```

This setup mode requests `browser-automation` permission and does not start recordings. macOS may ask to allow control of your browser, and the browser may restart once during setup. Wait for `browser-automation: granted`, then press Ctrl+C and run `npm start`. If permission is denied or setup fails, check System Settings → Privacy & Security → Automation and run setup again. Repeat setup if you change browsers.

The SDK chooses Raw Media when the workspace, browser, permissions, and meeting context support it. Otherwise it can fall back to local recording; setting the diarization option alone does not guarantee separate participant streams in the case of the fallback being triggered.