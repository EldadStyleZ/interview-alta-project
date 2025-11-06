import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import {
  validatePreDial,
  validateInCall,
  validatePreBooking,
  validatePreWrite,
  validatePolicy,
} from '../src/policy/validator';

describe('Policy Validator', () => {
  describe('validatePreDial', () => {
    it('passes when all checks pass', () => {
      const context = {
        lead_id: '00Q1234567890ABC',
        dnc_flag: false,
        attempts_this_week: 2,
        last_attempt_ts: '2024-03-14T10:00:00.000Z',
        lead_timezone: 'America/New_York',
        current_time_utc: '2024-03-15T14:00:00.000Z', // 10:00 EST
      };

      const result = validatePreDial(context);
      expect(result.pass).toBe(true);
    });

    it('blocks when DNC flag is true', () => {
      const context = {
        lead_id: '00Q1234567890ABC',
        dnc_flag: true,
      };

      const result = validatePreDial(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('DNC_BLOCKED');
      expect(result.reason).toContain('do-not-call');
    });

    it('blocks when attempts_this_week >= 3', () => {
      const context = {
        lead_id: '00Q1234567890ABC',
        dnc_flag: false,
        attempts_this_week: 3,
      };

      const result = validatePreDial(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('MAX_ATTEMPTS_EXCEEDED');
      expect(result.reason).toContain('Maximum attempts');
    });

    it('blocks when last attempt was less than 24 hours ago', () => {
      const context = {
        lead_id: '00Q1234567890ABC',
        dnc_flag: false,
        attempts_this_week: 1,
        last_attempt_ts: '2024-03-15T10:00:00.000Z',
        current_time_utc: '2024-03-15T20:00:00.000Z', // 10 hours later
      };

      const result = validatePreDial(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('MIN_GAP_NOT_MET');
      expect(result.reason).toContain('24-hour');
    });

    it('blocks when outside call window (before 09:00)', () => {
      const context = {
        lead_id: '00Q1234567890ABC',
        dnc_flag: false,
        attempts_this_week: 1,
        lead_timezone: 'America/New_York',
        current_time_utc: '2024-03-15T12:00:00.000Z', // 08:00 EST
      };

      const result = validatePreDial(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('OUTSIDE_CALL_WINDOW');
      expect(result.reason).toContain('outside call window');
    });

    it('blocks when outside call window (after 17:00)', () => {
      const context = {
        lead_id: '00Q1234567890ABC',
        dnc_flag: false,
        attempts_this_week: 1,
        lead_timezone: 'America/New_York',
        current_time_utc: '2024-03-15T22:00:00.000Z', // 18:00 EST
      };

      const result = validatePreDial(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('OUTSIDE_CALL_WINDOW');
    });
  });

  describe('validateInCall', () => {
    it('passes when all checks pass', () => {
      const context = {
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        consent_to_proceed: true,
        recording_consent: true,
        recording_active: true,
        opt_out_detected: false,
      };

      const result = validateInCall(context);
      expect(result.pass).toBe(true);
    });

    it('blocks when opt-out detected', () => {
      const context = {
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        opt_out_detected: true,
      };

      const result = validateInCall(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('OPT_OUT_DETECTED');
      expect(result.reason).toContain('Opt-out');
    });

    it('blocks when consent to proceed missing', () => {
      const context = {
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        consent_to_proceed: false,
        opt_out_detected: false,
      };

      const result = validateInCall(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('CONSENT_TO_PROCEED_MISSING');
      expect(result.reason).toContain('Consent to proceed');
    });

    it('blocks when recording active but consent not obtained', () => {
      const context = {
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        consent_to_proceed: true,
        recording_consent: null,
        recording_active: true,
        opt_out_detected: false,
      };

      const result = validateInCall(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('RECORDING_CONSENT_MISSING');
      expect(result.reason).toContain('Recording');
    });

    it('blocks when recording active but consent denied', () => {
      const context = {
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        consent_to_proceed: true,
        recording_consent: false,
        recording_active: true,
        opt_out_detected: false,
      };

      const result = validateInCall(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('RECORDING_CONSENT_MISSING');
      expect(result.reason).toContain('denied');
    });

    it('passes when recording not active', () => {
      const context = {
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        consent_to_proceed: true,
        recording_consent: null,
        recording_active: false,
        opt_out_detected: false,
      };

      const result = validateInCall(context);
      expect(result.pass).toBe(true);
    });
  });

  describe('validatePreBooking', () => {
    it('passes when all checks pass', () => {
      const context = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        explicit_confirmation: true,
        confirmed_date: '2024-03-15T19:00:00.000Z',
        confirmed_time: '2024-03-15T19:00:00.000Z',
        qualification_flags: { budget: true, authority: true },
      };

      const result = validatePreBooking(context);
      expect(result.pass).toBe(true);
    });

    it('blocks when explicit confirmation missing', () => {
      const context = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        explicit_confirmation: false,
        confirmed_date: '2024-03-15T19:00:00.000Z',
        confirmed_time: '2024-03-15T19:00:00.000Z',
        qualification_flags: { budget: true },
      };

      const result = validatePreBooking(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('EXPLICIT_CONFIRMATION_MISSING');
      expect(result.reason).toContain('Explicit verbal confirmation');
    });

    it('blocks when confirmed date missing', () => {
      const context = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        explicit_confirmation: true,
        confirmed_time: '2024-03-15T19:00:00.000Z',
        qualification_flags: { budget: true },
      };

      const result = validatePreBooking(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('CONFIRMED_DATETIME_MISSING');
      expect(result.reason).toContain('Confirmed date or time');
    });

    it('blocks when confirmed time missing', () => {
      const context = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        explicit_confirmation: true,
        confirmed_date: '2024-03-15T19:00:00.000Z',
        qualification_flags: { budget: true },
      };

      const result = validatePreBooking(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('CONFIRMED_DATETIME_MISSING');
    });

    it('blocks when qualification flags missing', () => {
      const context = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        explicit_confirmation: true,
        confirmed_date: '2024-03-15T19:00:00.000Z',
        confirmed_time: '2024-03-15T19:00:00.000Z',
      };

      const result = validatePreBooking(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('QUALIFICATION_FLAGS_MISSING');
      expect(result.reason).toContain('Qualification flags');
    });

    it('blocks when qualification flags empty', () => {
      const context = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        explicit_confirmation: true,
        confirmed_date: '2024-03-15T19:00:00.000Z',
        confirmed_time: '2024-03-15T19:00:00.000Z',
        qualification_flags: {},
      };

      const result = validatePreBooking(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('QUALIFICATION_FLAGS_MISSING');
    });
  });

  describe('validatePreWrite', () => {
    it('passes when all checks pass for calendar', () => {
      const context = {
        payload_type: 'calendar',
        payload: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
        idempotency_key: '770e8400-e29b-41d4-a716-446655440001',
        region: 'us-east-1',
        expected_region: 'us-east-1',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(true);
    });

    it('passes when all checks pass for CRM', () => {
      const context = {
        payload_type: 'crm',
        payload: { booking_id: '550e8400-e29b-41d4-a716-446655440000' },
        idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
        region: 'us-east-1',
        expected_region: 'us-east-1',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(true);
    });

    it('passes when all checks pass for analytics', () => {
      const context = {
        payload_type: 'analytics',
        payload: { event_id: '880e8400-e29b-41d4-a716-446655440003' },
        idempotency_key: '880e8400-e29b-41d4-a716-446655440003',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(true);
    });

    it('blocks when payload is empty', () => {
      const context = {
        payload_type: 'calendar',
        payload: {},
        idempotency_key: 'test-key',
        region: 'us-east-1',
        expected_region: 'us-east-1',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('PAYLOAD_INCOMPLETE');
    });

    it('blocks when idempotency key missing', () => {
      const context = {
        payload_type: 'calendar',
        payload: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
        region: 'us-east-1',
        expected_region: 'us-east-1',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('IDEMPOTENCY_KEY_MISSING');
      expect(result.reason).toContain('Idempotency key');
    });

    it('blocks when idempotency key is empty string', () => {
      const context = {
        payload_type: 'crm',
        payload: { booking_id: '550e8400-e29b-41d4-a716-446655440000' },
        idempotency_key: '',
        region: 'us-east-1',
        expected_region: 'us-east-1',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('IDEMPOTENCY_KEY_MISSING');
    });

    it('blocks when region routing missing for calendar', () => {
      const context = {
        payload_type: 'calendar',
        payload: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
        idempotency_key: 'test-key',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('REGION_ROUTING_MISSING');
      expect(result.reason).toContain('Region routing');
    });

    it('blocks when region mismatch for CRM', () => {
      const context = {
        payload_type: 'crm',
        payload: { booking_id: '550e8400-e29b-41d4-a716-446655440000' },
        idempotency_key: 'test-key',
        region: 'us-east-1',
        expected_region: 'eu-west-1',
      };

      const result = validatePreWrite(context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('REGION_MISMATCH');
      expect(result.reason).toContain('Region mismatch');
    });
  });

  describe('validatePolicy', () => {
    it('routes to correct validator for preDial', () => {
      const context = { lead_id: 'test', dnc_flag: true };
      const result = validatePolicy('preDial', context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('DNC_BLOCKED');
    });

    it('routes to correct validator for inCall', () => {
      const context = { call_id: 'test', opt_out_detected: true };
      const result = validatePolicy('inCall', context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('OPT_OUT_DETECTED');
    });

    it('routes to correct validator for preBooking', () => {
      const context = { booking_id: 'test', explicit_confirmation: false };
      const result = validatePolicy('preBooking', context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('EXPLICIT_CONFIRMATION_MISSING');
    });

    it('routes to correct validator for preWrite', () => {
      const context = { payload_type: 'calendar', payload: {}, idempotency_key: '' };
      const result = validatePolicy('preWrite', context);
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('IDEMPOTENCY_KEY_MISSING');
    });

    it('returns error for unknown gate', () => {
      const result = validatePolicy('unknown' as any, {});
      expect(result.pass).toBe(false);
      expect(result.reasonCode).toBe('UNKNOWN_GATE');
    });
  });

  describe('POST /policy/check endpoint', () => {
    it('returns pass for valid preDial context', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'preDial',
        context: {
          lead_id: '00Q1234567890ABC',
          dnc_flag: false,
          attempts_this_week: 1,
          lead_timezone: 'America/New_York',
          current_time_utc: '2024-03-15T14:00:00.000Z',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.pass).toBe(true);
    });

    it('returns block with reason for DNC flag', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'preDial',
        context: {
          lead_id: '00Q1234567890ABC',
          dnc_flag: true,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.pass).toBe(false);
      expect(res.body.reasonCode).toBe('DNC_BLOCKED');
      expect(res.body.reason).toBeDefined();
    });

    it('returns block for missing consent to proceed', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'inCall',
        context: {
          call_id: '550e8400-e29b-41d4-a716-446655440000',
          consent_to_proceed: false,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.pass).toBe(false);
      expect(res.body.reasonCode).toBe('CONSENT_TO_PROCEED_MISSING');
    });

    it('returns block for missing explicit confirmation', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'preBooking',
        context: {
          booking_id: '550e8400-e29b-41d4-a716-446655440000',
          explicit_confirmation: false,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.pass).toBe(false);
      expect(res.body.reasonCode).toBe('EXPLICIT_CONFIRMATION_MISSING');
    });

    it('returns block for missing idempotency key', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'preWrite',
        context: {
          payload_type: 'calendar',
          payload: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.pass).toBe(false);
      expect(res.body.reasonCode).toBe('IDEMPOTENCY_KEY_MISSING');
    });

    it('returns 400 for invalid gate type', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'invalidGate',
        context: {},
      });

      expect(res.status).toBe(400);
      expect(res.body.pass).toBe(false);
      expect(res.body.reasonCode).toBe('INVALID_GATE');
    });

    it('returns 400 for missing context', async () => {
      const res = await request(app).post('/policy/check').send({
        gate: 'preDial',
      });

      expect(res.status).toBe(400);
      expect(res.body.pass).toBe(false);
      expect(res.body.reasonCode).toBe('INVALID_CONTEXT');
    });
  });
});

