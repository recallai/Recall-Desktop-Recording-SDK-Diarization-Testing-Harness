# Recall.ai Desktop Recording SDK — Diarization Testing Harness

A minimal Electron app for evaluating Recall Desktop Recording SDK diarization with Google Meet on macOS. It detects meetings, records on demand, displays finalized speaker-attributed transcript events in real time, and exports the transcript as JSON.

## Setup

1. Use Node.js 22 or newer and install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `RECALL_API_KEY` and the `RECALL_API_URL` for your Recall.ai account region.
4. Enable Desktop SDK Raw Media for the Recall.ai workspace associated with the API key through your Recall.ai account team.
5. On an Apple Silicon Mac running macOS 13 or later, set Chrome, Arc, Brave, Comet, or Dia as the default browser and run:

```sh
npm run setup:google-meet
```

Approve browser automation if macOS prompts for it. The browser may restart once. Wait for `browser-automation: granted`, then press Ctrl+C.

## Run

```sh
npm start
```

Join a Google Meet, wait for **Meeting detected**, then use **Start recording** and **Stop recording**. The stop button shows progress until the SDK emits `recording-ended`.

Finalized `transcript.data` utterances appear live with the participant name or a fallback speaker label. **Export JSON** opens a native save dialog with a default name such as `recording_2026-09-13T20-15-30Z.json`.

The SDK chooses Raw Media when the workspace, browser, permissions, and meeting context support it. Otherwise it can fall back to local recording; the diarization option alone cannot guarantee separate participant streams.
