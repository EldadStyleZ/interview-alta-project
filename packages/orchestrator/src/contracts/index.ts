import { z } from 'zod';

// RFC 3339 UTC timestamp validation
const rfc3339UtcRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const rfc3339UtcString = z
  .string()
  .regex(rfc3339UtcRegex, 'Timestamp must be RFC 3339 UTC format (YYYY-MM-DDTHH:mm:ss.sssZ)');

// UUID validation
const uuidString = z.string().uuid();

// Salesforce ID format (15 or 18 characters, alphanumeric)
const salesforceIdString = z.string().regex(/^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/);

// Email validation (RFC 5322 basic)
const emailString = z.string().email();

// HTTPS URL validation
const httpsUrlString = z.string().url().refine((url) => url.startsWith('https://'), {
  message: 'URL must use HTTPS',
});

// E.164 phone format validation
const e164PhoneString = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format');

// IANA timezone validation (basic check)
const ianaTimezoneString = z.string().min(1);

// CallEvent Schema
export const CallEventSchema = z.object({
  call_id: uuidString,
  lead_id: salesforceIdString,
  attempt_no: z.number().int().min(1).max(3),
  status: z.enum(['connected', 'voicemail', 'busy', 'no_answer', 'failed']),
  start_ts: rfc3339UtcString,
  end_ts: rfc3339UtcString.nullable(),
  recording_url: httpsUrlString.nullable(),
  consent_status: z.enum(['granted', 'denied', 'not_asked']),
  dnc_flag: z.boolean(),
  asr_confidence: z.number().min(0).max(1).nullable(),
});

export type CallEvent = z.infer<typeof CallEventSchema>;

// ConsentRecord Schema
export const ConsentRecordSchema = z.object({
  consent_id: uuidString,
  subject_type: z.enum(['lead', 'contact']),
  subject_id: salesforceIdString,
  channel: z.enum(['voice', 'sms', 'email']),
  scope: z.enum(['call', 'recording', 'marketing']),
  status: z.enum(['granted', 'denied', 'withdrawn']),
  captured_ts: rfc3339UtcString,
  jurisdiction: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]+)?$/).nullable(), // ISO 3166-2 basic
  evidence_url: httpsUrlString.nullable(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

// Booking Schema
export const BookingSchema = z.object({
  booking_id: uuidString,
  lead_id: salesforceIdString,
  contact_id: salesforceIdString.nullable(),
  manager_id: salesforceIdString,
  outcome: z.enum(['booked', 'declined', 'reschedule_requested']),
  qualification_flags: z.record(z.unknown()), // JSON object
  notes: z.string().max(500).nullable(),
  call_id: uuidString,
  created_ts: rfc3339UtcString,
});

export type Booking = z.infer<typeof BookingSchema>;

// CalendarHold Schema
export const CalendarHoldSchema = z.object({
  tentative_id: uuidString,
  manager_id: salesforceIdString,
  start_utc: rfc3339UtcString,
  end_utc: rfc3339UtcString,
  created_by: z.literal('system'),
  ttl_seconds: z.number().int().min(300).max(1800),
});

export type CalendarHold = z.infer<typeof CalendarHoldSchema>;

// CalendarEvent Schema
export const CalendarEventSchema = z.object({
  meeting_id: uuidString,
  manager_id: salesforceIdString,
  contact_email: emailString.nullable(),
  title: z.string().max(200),
  start_utc: rfc3339UtcString,
  end_utc: rfc3339UtcString,
  location: z.string().nullable(),
  meeting_url: httpsUrlString.nullable(),
  timezone: ianaTimezoneString,
  description: z.string().nullable(),
  invitees_emails: z.array(emailString),
  source_system: z.literal('ai-outbound'),
  iCal_uid: uuidString,
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ConfirmationMessage Schema
export const ConfirmationMessageSchema = z.object({
  message_id: uuidString,
  channel: z.enum(['email', 'sms']),
  to: z.union([emailString, e164PhoneString]),
  template_id: z.string(),
  payload_json: z.record(z.unknown()), // JSON object
  sent_ts: rfc3339UtcString,
  delivery_status: z.enum(['queued', 'sent', 'failed']),
});

export type ConfirmationMessage = z.infer<typeof ConfirmationMessageSchema>;

// AnalyticsEvent Schema
export const AnalyticsEventSchema = z.object({
  event_id: uuidString,
  event_type: z.string(),
  entity_id: uuidString,
  ts: rfc3339UtcString,
  attributes_json: z.record(z.unknown()), // JSON object
  pii_redacted: z.boolean(),
});

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

// Pre-write gate validation
export type WritePayload =
  | { type: 'calendar'; payload: CalendarEvent }
  | { type: 'crm'; payload: Booking }
  | { type: 'analytics'; payload: AnalyticsEvent };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function preWriteGate(payload: WritePayload): ValidationResult {
  const errors: string[] = [];

  // Validate timestamps are RFC 3339 UTC
  const validateTimestamps = (obj: Record<string, unknown>): void => {
    Object.entries(obj).forEach(([key, value]) => {
      if (key.includes('_ts') || key.includes('_utc') || key === 'ts') {
        if (typeof value === 'string' && !rfc3339UtcRegex.test(value)) {
          errors.push(`Field ${key} must be RFC 3339 UTC format, got: ${value}`);
        }
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        validateTimestamps(value as Record<string, unknown>);
      }
    });
  };

  // Check required fields based on payload type
  if (payload.type === 'calendar') {
    // Validate iCal UID present (idempotency key)
    if (!payload.payload.iCal_uid || typeof payload.payload.iCal_uid !== 'string' || payload.payload.iCal_uid.length === 0) {
      errors.push('iCal_uid is required for calendar events');
    }

    // Validate schema
    const result = CalendarEventSchema.safeParse(payload.payload);
    if (!result.success) {
      errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
    }

    // Validate timestamps are RFC 3339 UTC
    validateTimestamps(payload.payload as Record<string, unknown>);
  } else if (payload.type === 'crm') {
    // Validate booking_id present (idempotency key)
    if (!payload.payload.booking_id || typeof payload.payload.booking_id !== 'string' || payload.payload.booking_id.length === 0) {
      errors.push('booking_id is required for CRM writes');
    }

    // Validate schema
    const result = BookingSchema.safeParse(payload.payload);
    if (!result.success) {
      errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
    }

    // Validate timestamps are RFC 3339 UTC
    validateTimestamps(payload.payload as Record<string, unknown>);
  } else if (payload.type === 'analytics') {
    // Validate PII minimization flag
    if (payload.payload.pii_redacted !== true) {
      errors.push('pii_redacted must be true for analytics events');
    }

    // Validate schema
    const result = AnalyticsEventSchema.safeParse(payload.payload);
    if (!result.success) {
      errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
    }

    // Validate timestamps are RFC 3339 UTC
    validateTimestamps(payload.payload as Record<string, unknown>);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Export validators
export const validators = {
  CallEvent: CallEventSchema,
  ConsentRecord: ConsentRecordSchema,
  Booking: BookingSchema,
  CalendarHold: CalendarHoldSchema,
  CalendarEvent: CalendarEventSchema,
  ConfirmationMessage: ConfirmationMessageSchema,
  AnalyticsEvent: AnalyticsEventSchema,
};

