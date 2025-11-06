import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { getCallSession } from '../src/agent/orchestrator.js';

describe('Call Orchestration', () => {
  beforeEach(() => {
    // Clear any existing sessions between tests
  });

  describe('POST /voice/answer', () => {
    it('creates call session and sends mandatory opener lines', async () => {
      const res = await request(app).post('/voice/answer').send({
        lead_id: 'lead-123',
        phone_number: '+1234567890',
        attempt_no: 1,
        manager_id: 'manager-123',
      });

      expect(res.status).toBe(200);
      expect(res.body.call_id).toBeDefined();
      expect(res.body.initial_prompt).toBeDefined();
      expect(res.body.initial_prompt).toContain('Hello');
      expect(res.body.initial_prompt).toContain('schedule');
    });
  });

  describe('POST /voice/transcript', () => {
    it('processes transcript and transitions through states', async () => {
      // Create call session
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: 'lead-123',
        phone_number: '+1234567890',
        manager_id: 'manager-123',
      });

      const callId = answerRes.body.call_id;

      // Send consent transcript
      const consentRes = await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'Yes, I have a few minutes',
        confidence: 0.95,
        is_final: true,
        manager_id: 'manager-123',
      });

      expect(consentRes.status).toBe(200);
      expect(consentRes.body.state).toBe('ConsentGate');
    });

    it('proposes times when qualified', async () => {
      const managerId = 'manager-123';
      const leadId = 'lead-123';

      // Create call session
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: leadId,
        phone_number: '+1234567890',
        manager_id: managerId,
      });

      const callId = answerRes.body.call_id;

      // Go through qualification
      await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'Yes, I have a few minutes',
        manager_id: managerId,
      });

      await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'Yes, I am the decision maker',
        manager_id: managerId,
      });

      await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'We have an urgent need this quarter',
        manager_id: managerId,
      });

      await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'We have budget approved',
        manager_id: managerId,
      });

      // Should now be in ProposeTime state
      const proposeRes = await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'Okay',
        manager_id: managerId,
      });

      expect(proposeRes.body.state).toBe('ProposeTime');
      expect(proposeRes.body.prompt).toContain('Option');
    });
  });

  describe('Opt-out handling', () => {
    it('records opt-out and ends session', async () => {
      const answerRes = await request(app).post('/voice/answer').send({
        lead_id: 'lead-123',
        phone_number: '+1234567890',
      });

      const callId = answerRes.body.call_id;

      const optOutRes = await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: 'Please stop calling me',
        confidence: 0.95,
        is_final: true,
      });

      expect(optOutRes.status).toBe(200);
      expect(optOutRes.body.state).toBe('OptOut');

      const session = getCallSession(callId);
      expect(session?.is_active).toBe(false);
    });
  });

  describe('Acceptance: POST /dev/simulate-call', () => {
    it('creates CalendarEvent, CRM Task, and confirmation in outbox', async () => {
      const res = await request(app).post('/dev/simulate-call').send({
        manager_id: '0051234567890XYZ',
        lead_id: '00Q1234567890ABC',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.booking_intent).toBeDefined();
      expect(res.body.artifacts.calendar_event).toBe('created');
      expect(res.body.artifacts.crm_task).toBe('created');
      expect(res.body.artifacts.confirmation).toBe('queued');

      // Verify booking intent has required fields
      if (res.body.booking_intent) {
        expect(res.body.booking_intent.lead_id).toBe('00Q1234567890ABC');
        expect(res.body.booking_intent.confirmed_time).toBeDefined();
        expect(res.body.booking_intent.explicit_confirmation).toBe(true);
      }
    });

    it('handles custom script', async () => {
      const res = await request(app).post('/dev/simulate-call').send({
        manager_id: '0051234567890XYZ',
        lead_id: '00Q1234567890ABC',
        script: [
          { text: 'Hello', state: 'IdentifyContact' },
          { text: 'Yes', state: 'ConsentGate' },
          { text: 'I am the decision maker', state: 'Qualify' },
          { text: 'Urgent need this quarter', state: 'Qualify' },
          { text: 'Budget approved', state: 'Qualify' },
          { text: 'Option 1', state: 'ProposeTime' },
          { text: 'Yes confirm', state: 'Confirm' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});


