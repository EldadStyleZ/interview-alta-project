/**
 * Audio chunk from TTS
 */
export interface AudioChunk {
  data: Buffer;
  call_id: string;
  timestamp: string; // RFC 3339 UTC
  format: 'pcm' | 'mp3' | 'opus';
  sample_rate: number;
}

/**
 * Text stream input (can be async iterator of strings)
 */
export type TextStream = AsyncIterator<string> | ReadableStream<string>;

/**
 * Audio stream output
 */
export type AudioStream = AsyncIterator<AudioChunk>;

/**
 * TTS provider configuration
 */
export interface TTSConfig {
  provider: 'stub' | 'elevenlabs' | 'google' | 'aws';
  voice?: string;
  language?: string;
  sample_rate?: number;
  format?: 'pcm' | 'mp3' | 'opus';
  // Provider-specific config
  api_key?: string;
  endpoint?: string;
}

/**
 * TTS provider interface
 */
export interface TTSProvider {
  /**
   * Stream text to audio for a call
   * Returns async iterator of audio chunks
   */
  stream(call_id: string, textStream: TextStream): AudioStream;
}

/**
 * Stub TTS implementation for development
 * Simulates audio generation with configurable delay
 */
export class TtsStub implements TTSProvider {
  private config: TTSConfig;

  constructor(config: TTSConfig = { provider: 'stub' }) {
    this.config = config;
  }

  async *stream(call_id: string, textStream: TextStream): AudioStream {
    // Generate audio chunks for each text segment
    // TextStream can be AsyncIterator or ReadableStream, both are iterable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const text of textStream as any) {
      // Simulate processing delay based on text length
      const delay = Math.min(text.length * 10, 500); // 10ms per char, max 500ms
      await this.delay(delay);

      // Simulate audio chunk generation (generate dummy PCM data)
      const sampleRate = this.config.sample_rate || 16000;
      const duration = text.length * 0.1; // Rough estimate: 0.1s per character
      const samples = Math.floor(sampleRate * duration);
      const audioData = Buffer.alloc(samples * 2); // 16-bit PCM = 2 bytes per sample

      // Fill with silence (zeros) - in real implementation, this would be actual audio
      audioData.fill(0);

      yield {
        data: audioData,
        call_id,
        timestamp: new Date().toISOString(),
        format: this.config.format || 'pcm',
        sample_rate: sampleRate,
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create TTS provider based on config
 */
export function createTTSProvider(config: TTSConfig): TTSProvider {
  switch (config.provider) {
    case 'stub':
      return new TtsStub(config);
    case 'elevenlabs':
      // TODO: Implement ElevenLabs provider
      throw new Error('ElevenLabs provider not yet implemented');
    case 'google':
      // TODO: Implement Google Text-to-Speech provider
      throw new Error('Google provider not yet implemented');
    case 'aws':
      // TODO: Implement AWS Polly provider
      throw new Error('AWS provider not yet implemented');
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}

