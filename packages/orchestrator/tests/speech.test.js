import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { createASRProvider, AsrStub } from '../src/speech/asr';
import { createTTSProvider, TtsStub } from '../src/speech/tts';
describe('Speech Adapters', () => {
    describe('ASR Stub', () => {
        it('generates partial transcripts with confidence', async () => {
            const asr = new AsrStub();
            const callId = 'test-call-id';
            const dummyStream = async function* () {
                yield Buffer.alloc(100);
            };
            const partials = [];
            for await (const partial of asr.start(callId, dummyStream())) {
                partials.push({
                    text: partial.text,
                    confidence: partial.confidence,
                    is_final: partial.is_final,
                });
                if (partial.is_final)
                    break;
            }
            expect(partials.length).toBeGreaterThan(0);
            expect(partials[partials.length - 1].is_final).toBe(true);
            expect(partials[0].confidence).toBeGreaterThan(0);
            expect(partials[partials.length - 1].confidence).toBeGreaterThan(partials[0].confidence);
        });
    });
    describe('TTS Stub', () => {
        it('generates audio chunks from text stream', async () => {
            const tts = new TtsStub();
            const callId = 'test-call-id';
            async function* textStream() {
                yield 'Hello';
                yield ' world';
            }
            const chunks = [];
            for await (const chunk of tts.stream(callId, textStream())) {
                chunks.push({
                    format: chunk.format,
                    sample_rate: chunk.sample_rate,
                    data: chunk.data,
                });
            }
            expect(chunks.length).toBe(2);
            expect(chunks[0].format).toBe('pcm');
            expect(chunks[0].sample_rate).toBe(16000);
            expect(chunks[0].data.length).toBeGreaterThan(0);
        });
    });
    describe('Provider Factory', () => {
        it('creates ASR stub provider', () => {
            const config = { provider: 'stub' };
            const asr = createASRProvider(config);
            expect(asr).toBeInstanceOf(AsrStub);
        });
        it('throws for unimplemented ASR provider', () => {
            const config = { provider: 'deepgram' };
            expect(() => createASRProvider(config)).toThrow('not yet implemented');
        });
        it('creates TTS stub provider', () => {
            const config = { provider: 'stub' };
            const tts = createTTSProvider(config);
            expect(tts).toBeInstanceOf(TtsStub);
        });
        it('throws for unimplemented TTS provider', () => {
            const config = { provider: 'elevenlabs' };
            expect(() => createTTSProvider(config)).toThrow('not yet implemented');
        });
    });
    describe('POST /dev/simulate-speech', () => {
        it('simulates conversation and logs partials', async () => {
            const res = await request(app).post('/dev/simulate-speech').send({
                call_id: 'test-simulation-call',
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.call_id).toBe('test-simulation-call');
            expect(res.body.turns).toBe(7); // 4 AI turns + 3 human turns
            expect(res.body.partials).toBeGreaterThan(0);
            expect(res.body.summary).toHaveProperty('ai_turns', 4);
            expect(res.body.summary).toHaveProperty('human_turns', 3);
            expect(res.body.summary).toHaveProperty('total_partials');
        });
        it('accepts custom ASR and TTS config', async () => {
            const res = await request(app).post('/dev/simulate-speech').send({
                call_id: 'test-custom-config',
                asr_config: { provider: 'stub', language: 'en-US' },
                tts_config: { provider: 'stub', voice: 'default', format: 'mp3' },
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
        it('generates call_id if not provided', async () => {
            const res = await request(app).post('/dev/simulate-speech').send({});
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.call_id).toBeDefined();
            expect(typeof res.body.call_id).toBe('string');
        });
    });
});
