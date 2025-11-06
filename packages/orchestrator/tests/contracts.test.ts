import { describe, it, expect } from '@jest/globals';
import {
  preWriteGate,
  CalendarEventSchema,
  BookingSchema,
  AnalyticsEventSchema,
  type WritePayload,
} from '../src/contracts/index';

describe('preWriteGate', () => {
  describe('CalendarEvent validation', () => {
    it('accepts valid calendar event payload', () => {
      const payload: WritePayload = {
        type: 'calendar',
        payload: {
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          manager_id: '0051234567890XYZ',
          contact_email: 'prospect@acme.com',
          title: 'Discovery Meeting',
          start_utc: '2024-03-15T19:00:00.000Z',
          end_utc: '2024-03-15T19:30:00.000Z',
          location: null,
          meeting_url: null,
          timezone: 'America/New_York',
          description: null,
          invitees_emails: ['manager@company.com', 'prospect@acme.com'],
          source_system: 'ai-outbound',
          iCal_uid: '770e8400-e29b-41d4-a716-446655440001',
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects calendar event with invalid timestamp format', () => {
      const payload: WritePayload = {
        type: 'calendar',
        payload: {
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          manager_id: '0051234567890XYZ',
          contact_email: null,
          title: 'Discovery Meeting',
          start_utc: '2024-03-15T19:00:00', // Missing Z and milliseconds
          end_utc: '2024-03-15T19:30:00Z',
          location: null,
          meeting_url: null,
          timezone: 'America/New_York',
          description: null,
          invitees_emails: ['manager@company.com'],
          source_system: 'ai-outbound',
          iCal_uid: '770e8400-e29b-41d4-a716-446655440001',
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('start_utc'))).toBe(true);
    });

    it('rejects calendar event missing iCal_uid', () => {
      const payload: WritePayload = {
        type: 'calendar',
        payload: {
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          manager_id: '0051234567890XYZ',
          contact_email: null,
          title: 'Discovery Meeting',
          start_utc: '2024-03-15T19:00:00.000Z',
          end_utc: '2024-03-15T19:30:00.000Z',
          location: null,
          meeting_url: null,
          timezone: 'America/New_York',
          description: null,
          invitees_emails: ['manager@company.com'],
          source_system: 'ai-outbound',
          iCal_uid: '', // Empty string
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('iCal_uid'))).toBe(true);
    });

    it('rejects calendar event with non-UTC timestamp', () => {
      const payload: WritePayload = {
        type: 'calendar',
        payload: {
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          manager_id: '0051234567890XYZ',
          contact_email: null,
          title: 'Discovery Meeting',
          start_utc: '2024-03-15T19:00:00-05:00', // Timezone offset instead of Z
          end_utc: '2024-03-15T19:30:00.000Z',
          location: null,
          meeting_url: null,
          timezone: 'America/New_York',
          description: null,
          invitees_emails: ['manager@company.com'],
          source_system: 'ai-outbound',
          iCal_uid: '770e8400-e29b-41d4-a716-446655440001',
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('start_utc') && e.includes('RFC 3339 UTC'))).toBe(true);
    });
  });

  describe('Booking (CRM) validation', () => {
    it('accepts valid booking payload', () => {
      const payload: WritePayload = {
        type: 'crm',
        payload: {
          booking_id: '550e8400-e29b-41d4-a716-446655440000',
          lead_id: '00Q1234567890ABC',
          contact_id: null,
          manager_id: '0051234567890XYZ',
          outcome: 'booked',
          qualification_flags: { budget: true, authority: true },
          notes: null,
          call_id: '660e8400-e29b-41d4-a716-446655440001',
          created_ts: '2024-03-15T19:00:00.000Z',
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects booking missing booking_id', () => {
      const payload: WritePayload = {
        type: 'crm',
        payload: {
          booking_id: '', // Empty string
          lead_id: '00Q1234567890ABC',
          contact_id: null,
          manager_id: '0051234567890XYZ',
          outcome: 'booked',
          qualification_flags: {},
          notes: null,
          call_id: '660e8400-e29b-41d4-a716-446655440001',
          created_ts: '2024-03-15T19:00:00.000Z',
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('booking_id') && e.includes('required'))).toBe(true);
    });

    it('rejects booking with invalid timestamp format', () => {
      const payload: WritePayload = {
        type: 'crm',
        payload: {
          booking_id: '550e8400-e29b-41d4-a716-446655440000',
          lead_id: '00Q1234567890ABC',
          contact_id: null,
          manager_id: '0051234567890XYZ',
          outcome: 'booked',
          qualification_flags: {},
          notes: null,
          call_id: '660e8400-e29b-41d4-a716-446655440001',
          created_ts: '2024-03-15 19:00:00', // Invalid format
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('created_ts'))).toBe(true);
    });
  });

  describe('AnalyticsEvent validation', () => {
    it('accepts valid analytics event with pii_redacted true', () => {
      const payload: WritePayload = {
        type: 'analytics',
        payload: {
          event_id: '880e8400-e29b-41d4-a716-446655440003',
          event_type: 'booking_success',
          entity_id: '550e8400-e29b-41d4-a716-446655440000',
          ts: '2024-03-15T19:00:00.000Z',
          attributes_json: { meeting_id: '770e8400-e29b-41d4-a716-446655440002' },
          pii_redacted: true,
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects analytics event with pii_redacted false', () => {
      const payload: WritePayload = {
        type: 'analytics',
        payload: {
          event_id: '880e8400-e29b-41d4-a716-446655440003',
          event_type: 'booking_success',
          entity_id: '550e8400-e29b-41d4-a716-446655440000',
          ts: '2024-03-15T19:00:00.000Z',
          attributes_json: {},
          pii_redacted: false,
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('pii_redacted') && e.includes('true'))).toBe(true);
    });

    it('rejects analytics event with invalid timestamp', () => {
      const payload: WritePayload = {
        type: 'analytics',
        payload: {
          event_id: '880e8400-e29b-41d4-a716-446655440003',
          event_type: 'booking_success',
          entity_id: '550e8400-e29b-41d4-a716-446655440000',
          ts: '2024-03-15T19:00:00', // Missing Z
          attributes_json: {},
          pii_redacted: true,
        },
      };

      const result = preWriteGate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ts'))).toBe(true);
    });
  });

  describe('Schema validation', () => {
    it('rejects invalid UUID in calendar event', () => {
      const result = CalendarEventSchema.safeParse({
        meeting_id: 'not-a-uuid',
        manager_id: '0051234567890XYZ',
        contact_email: null,
        title: 'Test',
        start_utc: '2024-03-15T19:00:00.000Z',
        end_utc: '2024-03-15T19:30:00.000Z',
        location: null,
        meeting_url: null,
        timezone: 'America/New_York',
        description: null,
        invitees_emails: ['test@example.com'],
        source_system: 'ai-outbound',
        iCal_uid: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some((e) => e.path.includes('meeting_id'))).toBe(true);
      }
    });

    it('rejects booking with invalid outcome enum', () => {
      const result = BookingSchema.safeParse({
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        lead_id: '00Q1234567890ABC',
        contact_id: null,
        manager_id: '0051234567890XYZ',
        outcome: 'invalid_outcome', // Invalid enum value
        qualification_flags: {},
        notes: null,
        call_id: '660e8400-e29b-41d4-a716-446655440001',
        created_ts: '2024-03-15T19:00:00.000Z',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some((e) => e.path.includes('outcome'))).toBe(true);
      }
    });

    it('rejects analytics event with missing required fields', () => {
      const result = AnalyticsEventSchema.safeParse({
        event_id: '880e8400-e29b-41d4-a716-446655440003',
        // Missing event_type, entity_id, ts, attributes_json, pii_redacted
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.length).toBeGreaterThan(0);
      }
    });
  });
});

