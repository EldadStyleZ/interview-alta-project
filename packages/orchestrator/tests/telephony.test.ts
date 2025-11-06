import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { callStore, createCallSession, processVoiceEvent, getCallById } from '../src/telephony/cpaas';

describe('Telephony CPaaS', () => {
  beforeEach(() => {
    // Clear call store before each test
    callStore.clear();
  });

  describe('POST /voice/answer', () => {
    it('creates a call session and returns call_id and instructions', async () => {
      const res = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
        phone_number: '+1234567890',
        attempt_no: 1,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('call_id');
      expect(res.body).toHaveProperty('session_id');
      expect(res.body).toHaveProperty('instructions');
      expect(res.body.instructions).toHaveProperty('text');
      expect(typeof res.body.call_id).toBe('string');
      expect(res.body.call_id.length).toBeGreaterThan(0);
    });

    it('returns 400 when lead_id is missing', async () => {
      const res = await request(app).post('/voice/answer').send({
        phone_number: '+1234567890',
      });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when phone_number is missing', async () => {
      const res = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
      });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /voice/events', () => {
    it('creates a CallEvent record for answered event', async () => {
      // First create a call session
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
        phone_number: '+1234567890',
      });

      const callId = answerRes.body.call_id;

      // Then post an answered event
      const eventRes = await request(app).post('/voice/events').send({
        call_id: callId,
        event_type: 'answered',
        lead_id: '00Q1234567890ABC',
        attempt_no: 1,
        timestamp: new Date().toISOString(),
      });

      expect(eventRes.status).toBe(200);
      expect(eventRes.body.success).toBe(true);
      expect(eventRes.body.call_id).toBe(callId);
      expect(eventRes.body.event_id).toBeDefined();

      // Verify CallEvent was created
      const call = getCallById(callId);
      expect(call).toBeDefined();
      expect(call?.call_id).toBe(callId);
      expect(call?.lead_id).toBe('00Q1234567890ABC');
      expect(call?.status).toBe('connected');
      expect(call?.attempt_no).toBe(1);
    });

    it('updates existing CallEvent for completed event', async () => {
      // Create call session
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
        phone_number: '+1234567890',
      });

      const callId = answerRes.body.call_id;

      // Post answered event
      await request(app).post('/voice/events').send({
        call_id: callId,
        event_type: 'answered',
        lead_id: '00Q1234567890ABC',
        attempt_no: 1,
      });

      // Post completed event
      const completedTime = new Date().toISOString();
      const completedRes = await request(app).post('/voice/events').send({
        call_id: callId,
        event_type: 'completed',
        lead_id: '00Q1234567890ABC',
        attempt_no: 1,
        timestamp: completedTime,
      });

      expect(completedRes.status).toBe(200);
      expect(completedRes.body.success).toBe(true);

      // Verify CallEvent was updated
      const call = getCallById(callId);
      expect(call).toBeDefined();
      expect(call?.status).toBe('connected');
      expect(call?.end_ts).toBe(completedTime);
    });

    it('handles voicemail event', async () => {
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
        phone_number: '+1234567890',
      });

      const callId = answerRes.body.call_id;

      const eventRes = await request(app).post('/voice/events').send({
        call_id: callId,
        event_type: 'voicemail',
        lead_id: '00Q1234567890ABC',
        attempt_no: 1,
      });

      expect(eventRes.status).toBe(200);
      expect(eventRes.body.success).toBe(true);

      const call = getCallById(callId);
      expect(call?.status).toBe('voicemail');
    });

    it('handles no-answer event', async () => {
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
        phone_number: '+1234567890',
      });

      const callId = answerRes.body.call_id;

      const eventRes = await request(app).post('/voice/events').send({
        call_id: callId,
        event_type: 'no-answer',
        lead_id: '00Q1234567890ABC',
        attempt_no: 1,
      });

      expect(eventRes.status).toBe(200);
      expect(eventRes.body.success).toBe(true);

      const call = getCallById(callId);
      expect(call?.status).toBe('no_answer');
    });

    it('returns 400 when call_id is missing', async () => {
      const res = await request(app).post('/voice/events').send({
        event_type: 'answered',
        lead_id: '00Q1234567890ABC',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('call_id');
    });

    it('returns 400 when lead_id is missing', async () => {
      const res = await request(app).post('/voice/events').send({
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        event_type: 'answered',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('lead_id');
    });
  });

  describe('GET /calls/:id', () => {
    it('returns CallEvent for existing call', async () => {
      // Create call session
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: '00Q1234567890ABC',
        phone_number: '+1234567890',
      });

      const callId = answerRes.body.call_id;

      // Post event
      await request(app).post('/voice/events').send({
        call_id: callId,
        event_type: 'answered',
        lead_id: '00Q1234567890ABC',
        attempt_no: 1,
      });

      // Get call
      const getRes = await request(app).get(`/calls/${callId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.call_id).toBe(callId);
      expect(getRes.body.lead_id).toBe('00Q1234567890ABC');
      expect(getRes.body.status).toBe('connected');
      expect(getRes.body.attempt_no).toBe(1);
      expect(getRes.body.consent_status).toBe('not_asked');
      expect(getRes.body.dnc_flag).toBe(false);
    });

    it('returns 404 for non-existent call', async () => {
      const res = await request(app).get('/calls/non-existent-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns CallEvent after posting fake answered event', async () => {
      // This is the acceptance test case
      const fakeCallId = '550e8400-e29b-41d4-a716-446655440000';
      const leadId = '00Q1234567890ABC';
      const timestamp = new Date().toISOString();

      // Post fake answered event
      const eventRes = await request(app).post('/voice/events').send({
        call_id: fakeCallId,
        event_type: 'answered',
        lead_id: leadId,
        attempt_no: 1,
        timestamp,
      });

      expect(eventRes.status).toBe(200);
      expect(eventRes.body.success).toBe(true);

      // Get the call
      const getRes = await request(app).get(`/calls/${fakeCallId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        call_id: fakeCallId,
        lead_id: leadId,
        status: 'connected',
        attempt_no: 1,
        start_ts: timestamp,
        consent_status: 'not_asked',
        dnc_flag: false,
      });
    });
  });

  describe('createCallSession', () => {
    it('creates a call session with initial CallEvent', () => {
      const result = createCallSession('00Q1234567890ABC', 1);

      expect(result.call_id).toBeDefined();
      expect(result.session_id).toBeDefined();
      expect(result.instructions.text).toBeDefined();

      const call = getCallById(result.call_id);
      expect(call).toBeDefined();
      expect(call?.lead_id).toBe('00Q1234567890ABC');
      expect(call?.attempt_no).toBe(1);
      expect(call?.status).toBe('connected');
    });
  });

  describe('processVoiceEvent', () => {
    it('validates and stores CallEvent using contract schema', () => {
      const callId = '550e8400-e29b-41d4-a716-446655440000';
      const leadId = '00Q1234567890ABC';

      const result = processVoiceEvent(
        {
          call_id: callId,
          event_type: 'answered',
          timestamp: new Date().toISOString(),
        },
        leadId,
        1,
      );

      expect(result.success).toBe(true);
      expect(result.call_id).toBe(callId);

      const call = getCallById(callId);
      expect(call).toBeDefined();
      expect(call?.call_id).toBe(callId);
      expect(call?.lead_id).toBe(leadId);
    });

    it('returns error for invalid CallEvent data', () => {
      const result = processVoiceEvent(
        {
          call_id: 'invalid-uuid', // Invalid UUID
          event_type: 'answered',
        },
        '00Q1234567890ABC',
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

