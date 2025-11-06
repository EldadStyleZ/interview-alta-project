import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import {
  scheduleAttempt,
  recordAttempt,
  getAttempts,
  clearAttempts,
  isVoicemailAllowedForLead,
  getAttemptsThisWeek,
  has24HourSpacing,
  getTimeWindow,
} from '../src/attempts/strategy.js';

describe('Attempts Strategy', () => {
  beforeEach(() => {
    // Clear attempts between tests
    clearAttempts('lead-1');
    clearAttempts('lead-2');
    clearAttempts('lead-3');
  });

  describe('Basic scheduling', () => {
    it('schedules first attempt immediately if within time window', () => {
      const now = new Date('2024-03-15T14:00:00.000Z'); // 2 PM UTC (within US_EAST window)
      const result = scheduleAttempt('lead-1', 'US_EAST', now);

      expect(result.eligible).toBe(true);
      expect(result.next_attempt_ts).toBeDefined();
      expect(result.attempt_no).toBe(1);
    });

    it('schedules first attempt for next time window if outside', () => {
      const now = new Date('2024-03-15T22:00:00.000Z'); // 10 PM UTC (outside US_EAST window)
      const result = scheduleAttempt('lead-1', 'US_EAST', now);

      expect(result.eligible).toBe(false);
      expect(result.block_reason).toBe('OUTSIDE_TIME_WINDOW');
      expect(result.next_attempt_ts).toBeDefined();
      expect(new Date(result.next_attempt_ts!).getUTCHours()).toBe(13); // Next day at 1 PM UTC
    });
  });

  describe('24 hour spacing', () => {
    it('requires 24 hours between attempts', () => {
      const firstAttempt = new Date('2024-03-15T14:00:00.000Z');
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: firstAttempt.toISOString(),
        outcome: 'no_answer',
        region: 'US_EAST',
      });

      // Try to schedule immediately after
      const result1 = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-15T14:30:00.000Z'));
      expect(result1.eligible).toBe(false);
      expect(result1.block_reason).toBe('INSUFFICIENT_SPACING');

      // Try to schedule 23 hours later (still blocked)
      const result2 = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-16T13:00:00.000Z'));
      expect(result2.eligible).toBe(false);
      expect(result2.block_reason).toBe('INSUFFICIENT_SPACING');

      // Try to schedule 24 hours later (allowed)
      const result3 = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-16T14:00:00.000Z'));
      expect(result3.eligible).toBe(true);
      expect(result3.attempt_no).toBe(2);
    });

    it('allows immediate attempt if 24 hours have passed', () => {
      const firstAttempt = new Date('2024-03-15T14:00:00.000Z');
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: firstAttempt.toISOString(),
        outcome: 'no_answer',
      });

      const now = new Date('2024-03-16T14:00:00.000Z'); // Exactly 24 hours later
      const result = scheduleAttempt('lead-1', 'US_EAST', now);

      expect(result.eligible).toBe(true);
      expect(result.attempt_no).toBe(2);
    });
  });

  describe('Weekly limit (3 attempts per week)', () => {
    it('allows up to 3 attempts per week', () => {
      const monday = new Date('2024-03-11T14:00:00.000Z'); // Monday

      // Record 3 attempts
      for (let i = 1; i <= 3; i++) {
        const attemptTime = new Date(monday);
        attemptTime.setUTCDate(monday.getUTCDate() + (i - 1));
        recordAttempt({
          lead_id: 'lead-1',
          attempt_no: i,
          timestamp: attemptTime.toISOString(),
          outcome: 'no_answer',
        });
      }

      // Try to schedule 4th attempt in the same week
      const result = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-15T14:00:00.000Z'));
      expect(result.eligible).toBe(false);
      expect(result.block_reason).toBe('WEEKLY_LIMIT_EXCEEDED');
      expect(result.next_attempt_ts).toBeDefined();

      // Next attempt should be scheduled for next Monday
      const nextAttemptDate = new Date(result.next_attempt_ts!);
      expect(nextAttemptDate.getUTCDay()).toBe(1); // Monday
    });

    it('resets weekly count on new week', () => {
      const week1Monday = new Date('2024-03-11T14:00:00.000Z'); // Monday week 1

      // Record 3 attempts in week 1
      for (let i = 1; i <= 3; i++) {
        const attemptTime = new Date(week1Monday);
        attemptTime.setUTCDate(week1Monday.getUTCDate() + (i - 1));
        recordAttempt({
          lead_id: 'lead-1',
          attempt_no: i,
          timestamp: attemptTime.toISOString(),
          outcome: 'no_answer',
        });
      }

      // Try to schedule on Monday of week 2 (should be allowed)
      const week2Monday = new Date('2024-03-18T14:00:00.000Z'); // Monday week 2
      const result = scheduleAttempt('lead-1', 'US_EAST', week2Monday);

      expect(result.eligible).toBe(true);
      expect(result.attempt_no).toBe(4); // New attempt number continues
    });

    it('counts attempts correctly across week boundary', () => {
      const sunday = new Date('2024-03-10T14:00:00.000Z'); // Sunday (end of week)
      const monday = new Date('2024-03-11T14:00:00.000Z'); // Monday (start of week)

      // Record 2 attempts on Sunday
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: sunday.toISOString(),
        outcome: 'no_answer',
      });
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 2,
        timestamp: new Date(sunday.getTime() + 24 * 60 * 60 * 1000).toISOString(), // Next day (Monday)
        outcome: 'no_answer',
      });

      // Should be able to schedule 2 more in the new week
      const result = scheduleAttempt('lead-1', 'US_EAST', monday);
      expect(result.eligible).toBe(true);
      expect(result.attempt_no).toBe(3);
    });
  });

  describe('Voicemail policy', () => {
    it('allows voicemail only on attempt 2', () => {
      expect(isVoicemailAllowedForLead('lead-1')).toBe(false); // No attempts yet = attempt 1

      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: new Date().toISOString(),
        outcome: 'no_answer',
      });

      expect(isVoicemailAllowedForLead('lead-1')).toBe(true); // Attempt 2

      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 2,
        timestamp: new Date().toISOString(),
        outcome: 'voicemail',
      });

      expect(isVoicemailAllowedForLead('lead-1')).toBe(false); // Attempt 3
    });
  });

  describe('Busy retry (15 minutes)', () => {
    it('retries busy calls after 15 minutes', () => {
      const now = new Date('2024-03-15T14:00:00.000Z');
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: now.toISOString(),
        outcome: 'busy',
      });

      // Try to schedule immediately after busy call
      const result1 = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-15T14:05:00.000Z'));
      expect(result1.eligible).toBe(true);
      expect(result1.retry_after_ts).toBeDefined();
      expect(result1.attempt_no).toBe(1); // Same attempt number
      expect(new Date(result1.retry_after_ts!).getTime()).toBe(new Date('2024-03-15T14:15:00.000Z').getTime());

      // After 15 minutes, should allow normal scheduling
      const result2 = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-15T14:16:00.000Z'));
      expect(result2.eligible).toBe(true);
      expect(result2.attempt_no).toBe(2); // New attempt number
    });

    it('does not retry if more than 15 minutes have passed', () => {
      const now = new Date('2024-03-15T14:00:00.000Z');
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: now.toISOString(),
        outcome: 'busy',
      });

      // Try to schedule 16 minutes after busy call
      const result = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-15T14:16:00.000Z'));
      expect(result.eligible).toBe(true);
      expect(result.retry_after_ts).toBeUndefined();
      expect(result.attempt_no).toBe(2); // New attempt, not retry
    });

    it('does not retry non-busy outcomes', () => {
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: new Date('2024-03-15T14:00:00.000Z').toISOString(),
        outcome: 'no_answer',
      });

      const result = scheduleAttempt('lead-1', 'US_EAST', new Date('2024-03-15T14:05:00.000Z'));
      expect(result.retry_after_ts).toBeUndefined();
      expect(result.attempt_no).toBe(2);
    });
  });

  describe('Region time windows', () => {
    it('uses correct time window for US_EAST', () => {
      const window = getTimeWindow('US_EAST');
      expect(window.start).toBe(13); // 1 PM UTC
      expect(window.end).toBe(21); // 9 PM UTC
    });

    it('uses correct time window for US_WEST', () => {
      const window = getTimeWindow('US_WEST');
      expect(window.start).toBe(17); // 5 PM UTC
      expect(window.end).toBe(1); // 1 AM UTC (next day - wraps)
    });

    it('handles wrapping time windows correctly', () => {
      // Test US_WEST window (17:00 to 01:00)
      const window = getTimeWindow('US_WEST');
      
      // Test at 18:00 UTC (within window)
      const now1 = new Date('2024-03-15T18:00:00.000Z');
      const result1 = scheduleAttempt('lead-1', 'US_WEST', now1);
      expect(result1.eligible).toBe(true);

      // Test at 00:00 UTC (within window - wraps)
      const now2 = new Date('2024-03-15T00:00:00.000Z');
      const result2 = scheduleAttempt('lead-1', 'US_WEST', now2);
      expect(result2.eligible).toBe(true);

      // Test at 10:00 UTC (outside window)
      const now3 = new Date('2024-03-15T10:00:00.000Z');
      const result3 = scheduleAttempt('lead-1', 'US_WEST', now3);
      expect(result3.eligible).toBe(false);
      expect(result3.block_reason).toBe('OUTSIDE_TIME_WINDOW');
    });

    it('uses default window for unknown region', () => {
      const window = getTimeWindow('UNKNOWN');
      expect(window.start).toBe(13); // Same as DEFAULT
      expect(window.end).toBe(21);
    });

    it('schedules within region time window', () => {
      const now = new Date('2024-03-15T10:00:00.000Z'); // 10 AM UTC (before US_EAST window)
      const result = scheduleAttempt('lead-1', 'US_EAST', now);

      expect(result.eligible).toBe(false);
      expect(result.block_reason).toBe('OUTSIDE_TIME_WINDOW');
      const nextTime = new Date(result.next_attempt_ts!);
      expect(nextTime.getUTCHours()).toBe(13); // 1 PM UTC (window start)
    });
  });

  describe('POST /attempts/schedule', () => {
    it('returns schedule result for eligible attempt', async () => {
      const res = await request(app)
        .post('/attempts/schedule')
        .send({
          lead_id: 'lead-1',
          region: 'US_EAST',
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBeDefined();
      expect(res.body.attempt_no).toBe(1);
      expect(res.body.voicemail_allowed).toBe(false);
    });

    it('returns block reason for ineligible attempt', async () => {
      // Record 3 attempts
      const monday = new Date('2024-03-11T14:00:00.000Z');
      for (let i = 1; i <= 3; i++) {
        recordAttempt({
          lead_id: 'lead-1',
          attempt_no: i,
          timestamp: new Date(monday.getTime() + (i - 1) * 24 * 60 * 60 * 1000).toISOString(),
          outcome: 'no_answer',
        });
      }

      const res = await request(app).post('/attempts/schedule').send({
        lead_id: 'lead-1',
        region: 'US_EAST',
      });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.block_reason).toBe('WEEKLY_LIMIT_EXCEEDED');
      expect(res.body.next_attempt_ts).toBeDefined();
    });

    it('handles busy retry', async () => {
      const now = new Date('2024-03-15T14:00:00.000Z');
      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: now.toISOString(),
        outcome: 'busy',
      });

      const res = await request(app)
        .post('/attempts/schedule')
        .send({
          lead_id: 'lead-1',
          region: 'US_EAST',
          current_time: new Date('2024-03-15T14:05:00.000Z').toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
      expect(res.body.retry_after_ts).toBeDefined();
      expect(res.body.attempt_no).toBe(1);
    });
  });

  describe('Helper functions', () => {
    it('has24HourSpacing returns true for 24+ hour spacing', () => {
      const lastAttempt: any = {
        timestamp: '2024-03-15T14:00:00.000Z',
      };
      const now = new Date('2024-03-16T14:00:00.000Z'); // Exactly 24 hours

      expect(has24HourSpacing(lastAttempt, now)).toBe(true);
    });

    it('has24HourSpacing returns false for less than 24 hours', () => {
      const lastAttempt: any = {
        timestamp: '2024-03-15T14:00:00.000Z',
      };
      const now = new Date('2024-03-15T15:00:00.000Z'); // 1 hour later

      expect(has24HourSpacing(lastAttempt, now)).toBe(false);
    });

    it('getAttemptsThisWeek filters correctly', () => {
      const monday = new Date('2024-03-11T14:00:00.000Z'); // Monday
      const sunday = new Date('2024-03-10T14:00:00.000Z'); // Previous Sunday

      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 1,
        timestamp: sunday.toISOString(),
        outcome: 'no_answer',
      });

      recordAttempt({
        lead_id: 'lead-1',
        attempt_no: 2,
        timestamp: monday.toISOString(),
        outcome: 'no_answer',
      });

      const attempts = getAttempts('lead-1');
      const thisWeek = getAttemptsThisWeek(attempts);

      // Should only include Monday's attempt (Sunday is in previous week)
      expect(thisWeek.length).toBe(1);
      expect(thisWeek[0].attempt_no).toBe(2);
    });
  });
});

