function normalizeTranscriptEvent(event) {
  const utterance = event?.data?.data;
  const words = Array.isArray(utterance?.words) ? utterance.words : [];
  const text = words
    .map((word) => word?.text?.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1');
  if (!text) return null;

  const participant = utterance.participant || {};
  const name = typeof participant.name === 'string' ? participant.name.trim() : '';
  const speaker = name
    || (participant.is_host === true ? 'Host' : null)
    || (participant.id != null ? `Speaker ${participant.id}` : 'Unknown speaker');

  return {
    speaker,
    text,
    start_timestamp: words[0]?.start_timestamp || null,
    end_timestamp: words.at(-1)?.end_timestamp || null,
    participant: {
      id: participant.id ?? null,
      name: participant.name ?? null,
      is_host: participant.is_host ?? null,
      platform: participant.platform ?? null,
      email: participant.email ?? null,
    },
  };
}

function recordingFilename(date = new Date()) {
  const timestamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
  return `recording_${timestamp}.json`;
}

module.exports = { normalizeTranscriptEvent, recordingFilename };
