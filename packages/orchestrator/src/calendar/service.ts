import { createHash } from 'crypto';
import { CalendarEventSchema, CalendarHoldSchema, type CalendarEvent, type CalendarHold } from '../contracts/index.js';
import { preWriteGate, type WritePayload } from '../contracts/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface AvailabilityWindow {
  from: string; // RFC 3339 UTC
  to: string; // RFC 3339 UTC
}

export interface AvailabilitySlot {
  start_utc: string; // RFC 3339 UTC
  end_utc: string; // RFC 3339 UTC
  available: boolean;
}

interface HoldCacheEntry {
  hold: CalendarHold;
  expires_at: number; // Unix timestamp in milliseconds
}

// In-memory stores
const eventStore: Map<string, CalendarEvent> = new Map(); // keyed by meeting_id
const holdStore: Map<string, HoldCacheEntry> = new Map(); // keyed by tentative_id
const managerEvents: Map<string, CalendarEvent[]> = new Map(); // keyed by manager_id
const managerHolds: Map<string, HoldCacheEntry[]> = new Map(); // keyed by manager_id

// Buffer in milliseconds (10 minutes)
const BUFFER_MS = 10 * 60 * 1000;

/**
 * Clean up expired holds
 */
function cleanupExpiredHolds(): void {
  const now = Date.now();
  for (const [tentativeId, entry] of holdStore.entries()) {
    if (entry.expires_at <= now) {
      holdStore.delete(tentativeId);
      const managerId = entry.hold.manager_id;
      const holds = managerHolds.get(managerId) || [];
      const updatedHolds = holds.filter((h) => h.hold.tentative_id !== tentativeId);
      if (updatedHolds.length === 0) {
        managerHolds.delete(managerId);
      } else {
        managerHolds.set(managerId, updatedHolds);
      }
    }
  }
}

/**
 * Check if time slot overlaps with existing events or holds (including buffers)
 */
function hasOverlap(
  managerId: string,
  startUtc: string,
  endUtc: string,
  excludeTentativeId?: string,
): boolean {
  const start = new Date(startUtc).getTime();
  const end = new Date(endUtc).getTime();
  const startWithBuffer = start - BUFFER_MS;
  const endWithBuffer = end + BUFFER_MS;

  // Check events
  const events = managerEvents.get(managerId) || [];
  for (const event of events) {
    const eventStart = new Date(event.start_utc).getTime();
    const eventEnd = new Date(event.end_utc).getTime();

    // Check overlap with buffers
    if (
      (startWithBuffer < eventEnd && endWithBuffer > eventStart) ||
      (eventStart < endWithBuffer && eventEnd > startWithBuffer)
    ) {
      return true;
    }
  }

  // Check holds
  cleanupExpiredHolds();
  const holds = managerHolds.get(managerId) || [];
  for (const entry of holds) {
    if (excludeTentativeId && entry.hold.tentative_id === excludeTentativeId) {
      continue; // Exclude the hold we're checking against
    }
    const holdStart = new Date(entry.hold.start_utc).getTime();
    const holdEnd = new Date(entry.hold.end_utc).getTime();

    // Check overlap with buffers
    if (
      (startWithBuffer < holdEnd && endWithBuffer > holdStart) ||
      (holdStart < endWithBuffer && holdEnd > startWithBuffer)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Get availability for a manager within a window
 */
export function getAvailability(managerId: string, window: AvailabilityWindow): AvailabilitySlot[] {
  cleanupExpiredHolds();

  const from = new Date(window.from);
  const to = new Date(window.to);
  const slots: AvailabilitySlot[] = [];

  // Generate 30-minute slots
  const slotDuration = 30 * 60 * 1000; // 30 minutes in milliseconds
  let current = from;

  while (current < to) {
    const slotStart = current.toISOString();
    const slotEnd = new Date(current.getTime() + slotDuration).toISOString();

    // Check if slot is available (no overlaps)
    const available = !hasOverlap(managerId, slotStart, slotEnd);

    slots.push({
      start_utc: slotStart,
      end_utc: slotEnd,
      available,
    });

    current = new Date(current.getTime() + slotDuration);
  }

  return slots;
}

/**
 * Place a hold on a manager's calendar
 */
export function placeHold(
  params: Omit<CalendarHold, 'tentative_id' | 'created_by'>,
): { success: boolean; tentative_id?: string; error?: string } {
  const { manager_id, start_utc, end_utc, ttl_seconds } = params;

  // Validate TTL
  if (ttl_seconds < 300 || ttl_seconds > 1800) {
    return {
      success: false,
      error: 'ttl_seconds must be between 300 and 1800',
    };
  }

  // Check for overlaps
  cleanupExpiredHolds();
  if (hasOverlap(manager_id, start_utc, end_utc)) {
    return {
      success: false,
      error: 'Time slot overlaps with existing event or hold (including 10-minute buffers)',
    };
  }

  // Create hold
  const tentativeId = uuidv4();
  const hold: CalendarHold = {
    tentative_id: tentativeId,
    manager_id,
    start_utc,
    end_utc,
    created_by: 'system',
    ttl_seconds,
  };

  // Validate using schema
  const validationResult = CalendarHoldSchema.safeParse(hold);
  if (!validationResult.success) {
    return {
      success: false,
      error: `Validation failed: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
    };
  }

  // Store hold
  const expiresAt = Date.now() + ttl_seconds * 1000;
  const entry: HoldCacheEntry = {
    hold: validationResult.data,
    expires_at: expiresAt,
  };

  holdStore.set(tentativeId, entry);
  const holds = managerHolds.get(manager_id) || [];
  holds.push(entry);
  managerHolds.set(manager_id, holds);

  return {
    success: true,
    tentative_id: tentativeId,
  };
}

/**
 * Generate deterministic iCal UID from booking_id and start_utc
 */
function generateICalUid(bookingId: string, startUtc: string): string {
  const input = `${bookingId}${startUtc}`;
  const hash = createHash('sha256').update(input).digest('hex');
  // Format as UUID-like string for iCal compatibility
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

/**
 * Create a calendar event
 */
export function createEvent(event: CalendarEvent): { success: boolean; meeting_url?: string; iCal_uid?: string; error?: string } {
  // Generate deterministic iCal UID if not provided (before validation)
  if (!event.iCal_uid) {
    // Extract booking_id from meeting_id (assuming format)
    const bookingId = event.meeting_id;
    event.iCal_uid = generateICalUid(bookingId, event.start_utc);
  }

  // Validate using pre-write gate
  const payload: WritePayload = {
    type: 'calendar',
    payload: event,
  };

  const validationResult = preWriteGate(payload);
  if (!validationResult.valid) {
    return {
      success: false,
      error: `Validation failed: ${validationResult.errors.join(', ')}`,
    };
  }

  // Check for overlaps (excluding the hold if it exists)
  cleanupExpiredHolds();
  const holds = managerHolds.get(event.manager_id) || [];
  const matchingHold = holds.find((entry) => {
    const holdStart = new Date(entry.hold.start_utc).getTime();
    const eventStart = new Date(event.start_utc).getTime();
    return Math.abs(holdStart - eventStart) < 1000; // Within 1 second
  });

  if (hasOverlap(event.manager_id, event.start_utc, event.end_utc, matchingHold?.hold.tentative_id)) {
    return {
      success: false,
      error: 'Time slot overlaps with existing event or hold (including 10-minute buffers)',
    };
  }

  // Validate final event with schema
  const schemaResult = CalendarEventSchema.safeParse(event);
  if (!schemaResult.success) {
    return {
      success: false,
      error: `Schema validation failed: ${schemaResult.error.errors.map((e) => e.message).join(', ')}`,
    };
  }

  // Store event
  const validatedEvent = schemaResult.data;
  eventStore.set(validatedEvent.meeting_id, validatedEvent);

  // Add to manager's events
  const events = managerEvents.get(validatedEvent.manager_id) || [];
  events.push(validatedEvent);
  managerEvents.set(validatedEvent.manager_id, events);

  // Expire matching hold if exists
  if (matchingHold) {
    holdStore.delete(matchingHold.hold.tentative_id);
    const updatedHolds = holds.filter((h) => h.hold.tentative_id !== matchingHold.hold.tentative_id);
    if (updatedHolds.length === 0) {
      managerHolds.delete(validatedEvent.manager_id);
    } else {
      managerHolds.set(validatedEvent.manager_id, updatedHolds);
    }
  }

  // Generate fake conferencing URL
  const meetingUrl = `https://meet.example.com/${validatedEvent.meeting_id}`;

  return {
    success: true,
    meeting_url: meetingUrl,
    iCal_uid: validatedEvent.iCal_uid,
  };
}

/**
 * Get event by meeting_id
 */
export function getEvent(meetingId: string): CalendarEvent | undefined {
  return eventStore.get(meetingId);
}

/**
 * Get all events for a manager
 */
export function getManagerEvents(managerId: string): CalendarEvent[] {
  return managerEvents.get(managerId) || [];
}

/**
 * Get hold by tentative_id
 */
export function getHold(tentativeId: string): CalendarHold | undefined {
  cleanupExpiredHolds();
  const entry = holdStore.get(tentativeId);
  return entry?.hold;
}

// Export stores for testing
export { eventStore, holdStore, managerEvents, managerHolds };

