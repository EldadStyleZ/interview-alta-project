/**
 * Transcript storage service
 * Saves call transcripts to files for persistence and retrieval
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface TranscriptEntry {
  call_id: string;
  timestamp: string;
  text: string;
  confidence?: number;
  is_final?: boolean;
  speaker?: 'user' | 'ai';
}

export interface CallTranscript {
  call_id: string;
  call_started: string;
  call_ended?: string;
  entries: TranscriptEntry[];
}

// Ensure transcripts directory exists
const TRANSCRIPTS_DIR = join(process.cwd(), 'data', 'transcripts');

function ensureTranscriptsDir(): void {
  if (!existsSync(TRANSCRIPTS_DIR)) {
    mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  }
}

/**
 * Save a transcript entry to file
 */
export function saveTranscriptEntry(entry: TranscriptEntry): void {
  ensureTranscriptsDir();
  
  const transcriptFile = join(TRANSCRIPTS_DIR, `${entry.call_id}.json`);
  
  // Load existing transcript or create new one
  let transcript: CallTranscript;
  if (existsSync(transcriptFile)) {
    try {
      const content = readFileSync(transcriptFile, 'utf-8');
      transcript = JSON.parse(content);
    } catch (error) {
      // If file is corrupted, start fresh
      transcript = {
        call_id: entry.call_id,
        call_started: entry.timestamp,
        entries: [],
      };
    }
  } else {
    // New transcript
    transcript = {
      call_id: entry.call_id,
      call_started: entry.timestamp,
      entries: [],
    };
  }
  
  // Add new entry
  transcript.entries.push(entry);
  
  // Save back to file
  const writeStream = createWriteStream(transcriptFile, { flags: 'w' });
  writeStream.write(JSON.stringify(transcript, null, 2));
  writeStream.end();
}

/**
 * Get transcript for a call
 */
export function getTranscript(callId: string): CallTranscript | null {
  ensureTranscriptsDir();
  
  const transcriptFile = join(TRANSCRIPTS_DIR, `${callId}.json`);
  
  if (!existsSync(transcriptFile)) {
    return null;
  }
  
  try {
    const content = readFileSync(transcriptFile, 'utf-8');
    return JSON.parse(content) as CallTranscript;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error reading transcript for ${callId}:`, error);
    return null;
  }
}

/**
 * Mark call as ended in transcript
 */
export function markCallEnded(callId: string): void {
  ensureTranscriptsDir();
  
  const transcriptFile = join(TRANSCRIPTS_DIR, `${callId}.json`);
  
  if (!existsSync(transcriptFile)) {
    return;
  }
  
  try {
    const content = readFileSync(transcriptFile, 'utf-8');
    const transcript = JSON.parse(content) as CallTranscript;
    transcript.call_ended = new Date().toISOString();
    
    const writeStream = createWriteStream(transcriptFile, { flags: 'w' });
    writeStream.write(JSON.stringify(transcript, null, 2));
    writeStream.end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error marking call ended for ${callId}:`, error);
  }
}

/**
 * List all transcripts (for admin/debugging)
 */
export function listTranscripts(): string[] {
  ensureTranscriptsDir();
  
  if (!existsSync(TRANSCRIPTS_DIR)) {
    return [];
  }
  
  try {
    const files = readdirSync(TRANSCRIPTS_DIR);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace('.json', ''));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error listing transcripts:', error);
    return [];
  }
}

/**
 * Get full transcript text (all entries concatenated)
 */
export function getTranscriptText(callId: string): string | null {
  const transcript = getTranscript(callId);
  if (!transcript) {
    return null;
  }
  
  return transcript.entries
    .map((entry) => {
      const speaker = entry.speaker ? `[${entry.speaker.toUpperCase()}] ` : '';
      return `${speaker}${entry.text}`;
    })
    .join('\n');
}

