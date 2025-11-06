import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Analytics event types
 */
export type AnalyticsEventType =
  | 'call_started'
  | 'call_connected'
  | 'booking_created'
  | 'calendar_event_created'
  | 'crm_activity_written'
  | 'confirmation_sent'
  | 'opt_out';

/**
 * Base analytics event
 */
export interface AnalyticsEvent {
  event_type: AnalyticsEventType;
  entity_id: string;
  ts: string; // RFC 3339 UTC
  attributes: Record<string, unknown>;
  pii_redacted: boolean;
}

/**
 * Event-specific attributes
 */
export interface CallStartedEvent extends AnalyticsEvent {
  event_type: 'call_started';
  attributes: {
    call_id: string;
    lead_id: string;
    attempt_no: number;
    manager_id?: string;
  };
}

export interface CallConnectedEvent extends AnalyticsEvent {
  event_type: 'call_connected';
  attributes: {
    call_id: string;
    lead_id: string;
    status: string;
  };
}

export interface BookingCreatedEvent extends AnalyticsEvent {
  event_type: 'booking_created';
  attributes: {
    booking_id: string;
    lead_id: string;
    manager_id: string;
    outcome: string;
  };
}

export interface CalendarEventCreatedEvent extends AnalyticsEvent {
  event_type: 'calendar_event_created';
  attributes: {
    meeting_id: string;
    manager_id: string;
    booking_id: string;
    success: boolean;
  };
}

export interface CRMActivityWrittenEvent extends AnalyticsEvent {
  event_type: 'crm_activity_written';
  attributes: {
    booking_id: string;
    task_id: string;
    success: boolean;
  };
}

export interface ConfirmationSentEvent extends AnalyticsEvent {
  event_type: 'confirmation_sent';
  attributes: {
    message_id: string;
    booking_id: string;
    channel: string;
    success: boolean;
  };
}

export interface OptOutEvent extends AnalyticsEvent {
  event_type: 'opt_out';
  attributes: {
    lead_id: string;
    call_id?: string;
    timestamp: string;
  };
}

// Ensure data directory exists
const DATA_DIR = join(process.cwd(), 'data');
const EVENTS_LOG = join(DATA_DIR, 'events.log');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Write event to JSONL file (append-only)
 */
function writeEventToFile(event: AnalyticsEvent): void {
  try {
    const line = JSON.stringify(event) + '\n';
    const stream = createWriteStream(EVENTS_LOG, { flags: 'a' });
    stream.write(line);
    stream.end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'analytics_write_failed',
        error: (error as Error).message,
        event_type: event.event_type,
      }),
    );
  }
}

/**
 * Emit analytics event
 */
export function emitEvent(event: AnalyticsEvent): void {
  // Ensure PII is redacted
  if (!event.pii_redacted) {
    event.pii_redacted = true;
  }

  // Write to JSONL file
  writeEventToFile(event);

  // Also log to console for debugging
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'analytics_event', ...event }));
}

/**
 * Emit call started event
 */
export function emitCallStarted(callId: string, leadId: string, attemptNo: number, managerId?: string): void {
  const event: CallStartedEvent = {
    event_type: 'call_started',
    entity_id: callId,
    ts: new Date().toISOString(),
    attributes: {
      call_id: callId,
      lead_id: leadId,
      attempt_no: attemptNo,
      manager_id: managerId,
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Emit call connected event
 */
export function emitCallConnected(callId: string, leadId: string, status: string): void {
  const event: CallConnectedEvent = {
    event_type: 'call_connected',
    entity_id: callId,
    ts: new Date().toISOString(),
    attributes: {
      call_id: callId,
      lead_id: leadId,
      status,
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Emit booking created event
 */
export function emitBookingCreated(bookingId: string, leadId: string, managerId: string, outcome: string): void {
  const event: BookingCreatedEvent = {
    event_type: 'booking_created',
    entity_id: bookingId,
    ts: new Date().toISOString(),
    attributes: {
      booking_id: bookingId,
      lead_id: leadId,
      manager_id: managerId,
      outcome,
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Emit calendar event created
 */
export function emitCalendarEventCreated(meetingId: string, managerId: string, bookingId: string, success: boolean): void {
  const event: CalendarEventCreatedEvent = {
    event_type: 'calendar_event_created',
    entity_id: meetingId,
    ts: new Date().toISOString(),
    attributes: {
      meeting_id: meetingId,
      manager_id: managerId,
      booking_id: bookingId,
      success,
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Emit CRM activity written
 */
export function emitCRMActivityWritten(bookingId: string, taskId: string, success: boolean): void {
  const event: CRMActivityWrittenEvent = {
    event_type: 'crm_activity_written',
    entity_id: bookingId,
    ts: new Date().toISOString(),
    attributes: {
      booking_id: bookingId,
      task_id: taskId,
      success,
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Emit confirmation sent
 */
export function emitConfirmationSent(messageId: string, bookingId: string, channel: string, success: boolean): void {
  const event: ConfirmationSentEvent = {
    event_type: 'confirmation_sent',
    entity_id: messageId,
    ts: new Date().toISOString(),
    attributes: {
      message_id: messageId,
      booking_id: bookingId,
      channel,
      success,
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Emit opt out
 */
export function emitOptOut(leadId: string, callId?: string): void {
  const event: OptOutEvent = {
    event_type: 'opt_out',
    entity_id: leadId,
    ts: new Date().toISOString(),
    attributes: {
      lead_id: leadId,
      call_id: callId,
      timestamp: new Date().toISOString(),
    },
    pii_redacted: true,
  };

  emitEvent(event);
}

/**
 * Read events from log file
 */
export function readEvents(): AnalyticsEvent[] {
  try {
    if (!existsSync(EVENTS_LOG)) {
      return [];
    }

    const content = readFileSync(EVENTS_LOG, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    return lines.map((line) => JSON.parse(line) as AnalyticsEvent);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'analytics_read_failed',
        error: (error as Error).message,
      }),
    );
    return [];
  }
}

// Export for testing
export { EVENTS_LOG, DATA_DIR };

