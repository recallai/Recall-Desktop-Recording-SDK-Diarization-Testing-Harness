const { existsSync } = require('node:fs');
const { join } = require('node:path');
const RecallAiSdk = require('@recallai/desktop-sdk');

const envPath = join(__dirname, '.env.local');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const apiUrl = process.env.RECALL_API_URL || 'https://us-west-2.recall.ai';

function printHelp() {
  console.log(`Usage: npm run setup:google-meet

Request the Recall Desktop SDK browser-automation permission required for Google Meet detection. The supported default browser may restart once.`);
}

async function main() {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Google Meet Raw Media requires an Apple Silicon Mac running macOS 13 or later.');
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await RecallAiSdk.shutdown();
      process.exit();
    } catch (error) {
      console.error(`Shutdown failed: ${error.message}`);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.stdin.isTTY) {
    const wasRaw = Boolean(process.stdin.isRaw);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => { if (data.includes(3)) void shutdown(); });
    process.on('exit', () => process.stdin.setRawMode(wasRaw));
  }
  RecallAiSdk.addEventListener('permission-status', ({ permission, status }) => {
    if (permission === 'browser-automation') console.log(`browser-automation: ${status}`);
  });

  await RecallAiSdk.init({ apiUrl, acquirePermissionsOnStartup: [] });
  console.log('Approve browser automation if prompted. Your default browser may restart once.');
  await RecallAiSdk.requestPermission('browser-automation');
  console.log('Wait for "browser-automation: granted", then press Ctrl+C.');
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  console.log('---------------------------------------------------------------------------');
  printHelp();
  process.exit(1);
});
