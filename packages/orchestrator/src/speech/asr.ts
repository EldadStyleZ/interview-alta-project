/**
 * Partial transcript from ASR with confidence score
 */
export interface PartialTranscript {
  text: string;
  confidence: number; // 0.0 to 1.0
  is_final: boolean;
  call_id: string;
  timestamp: string; // RFC 3339 UTC
}

/**
 * Audio stream input (can be WebSocket, HTTP stream, etc.)
 */
export type AudioStream = AsyncIterator<Buffer> | ReadableStream<Buffer>;

/**
 * ASR provider configuration
 */
export interface ASRConfig {
  provider: 'stub' | 'deepgram' | 'google' | 'aws';
  language?: string;
  model?: string;
  sample_rate?: number;
  // Provider-specific config
  api_key?: string;
  endpoint?: string;
}

/**
 * ASR provider interface
 */
export interface ASRProvider {
  /**
   * Start transcription for a call
   * Returns async iterator of partial transcripts
   */
  start(call_id: string, audioStream: AudioStream): AsyncIterator<PartialTranscript>;
}

/**
 * Stub ASR implementation for development
 * Simulates partial transcripts with configurable delay and confidence
 */
export class AsrStub implements ASRProvider {
  private config: ASRConfig;

  constructor(config: ASRConfig = { provider: 'stub' }) {
    this.config = config;
  }

  async *start(call_id: string, _audioStream: AudioStream): AsyncIterator<PartialTranscript> {
    // Simulate partial transcripts with increasing confidence
    const phrases = [
      { text: 'Hello', confidence: 0.7 },
      { text: 'Hello, this is', confidence: 0.8 },
      { text: 'Hello, this is John', confidence: 0.85 },
      { text: 'Hello, this is John from', confidence: 0.9 },
      { text: 'Hello, this is John from Acme Corp', confidence: 0.95 },
    ];

    for (let i = 0; i < phrases.length; i++) {
      await this.delay(200); // Simulate processing delay

      yield {
        text: phrases[i].text,
        confidence: phrases[i].confidence,
        is_final: i === phrases.length - 1,
        call_id,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create ASR provider based on config
 */
export function createASRProvider(config: ASRConfig): ASRProvider {
  switch (config.provider) {
    case 'stub':
      return new AsrStub(config);
    case 'deepgram':
      // TODO: Implement Deepgram provider
      throw new Error('Deepgram provider not yet implemented');
    case 'google':
      // TODO: Implement Google Speech-to-Text provider
      throw new Error('Google provider not yet implemented');
    case 'aws':
      // TODO: Implement AWS Transcribe provider
      throw new Error('AWS provider not yet implemented');
    default:
      throw new Error(`Unknown ASR provider: ${config.provider}`);
  }
}

