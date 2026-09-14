const assert = require('node:assert/strict');
const test = require('node:test');
const { createRecorder } = require('./recorder');

function createSdk() {
  const listeners = new Map();
  const requestedPermissions = [];

  return {
    requestedPermissions,
    async init() {},
    async requestPermission(permission) { requestedPermissions.push(permission); },
    async shutdown() {},
    addEventListener(event, listener) {
      const eventListeners = listeners.get(event) || new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    removeEventListener(event, listener) { listeners.get(event)?.delete(listener); },
    emit(event, payload) {
      for (const listener of listeners.get(event) || []) listener(payload);
    },
  };
}

test('initializes Google Meet browser permission from the running recorder', async () => {
  const sdk = createSdk();
  const recorder = createRecorder({
    sdk,
    apiUrl: 'https://example.com',
    apiKey: 'test-key',
    platform: 'darwin',
    arch: 'arm64',
  });

  await recorder.initialize();
  await recorder.initializePermissions();

  assert.deepEqual(sdk.requestedPermissions, ['browser-automation']);
  assert.equal(recorder.getSnapshot().state.browserAutomationStatus, 'requested');

  sdk.emit('permission-status', { permission: 'browser-automation', status: 'granted' });
  const state = recorder.getSnapshot().state;
  assert.equal(state.browserAutomationStatus, 'granted');
  assert.equal(state.permissionRequestPending, false);

  await recorder.initializePermissions();
  assert.deepEqual(sdk.requestedPermissions, ['browser-automation']);
});

test('rejects Google Meet browser permission setup on unsupported systems', async () => {
  const sdk = createSdk();
  const recorder = createRecorder({
    sdk,
    apiUrl: 'https://example.com',
    apiKey: 'test-key',
    platform: 'linux',
    arch: 'x64',
  });

  await recorder.initialize();
  await assert.rejects(
    recorder.initializePermissions(),
    /requires an Apple Silicon Mac running macOS 13 or later/,
  );
  assert.deepEqual(sdk.requestedPermissions, []);
});
