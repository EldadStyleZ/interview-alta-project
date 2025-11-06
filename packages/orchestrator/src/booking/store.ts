import { v4 as uuidv4 } from 'uuid';
import { BookingSchema, type Booking } from '../contracts/index.js';

/**
 * Booking record with artifacts
 */
export interface BookingRecord {
  booking: Booking;
  artifacts: {
    tentative_id?: string;
    meeting_id?: string;
    task_id?: string; // External_Id__c from Salesforce
    confirmation_message_ids?: string[];
  };
  created_at: string; // RFC 3339 UTC
}

// In-memory booking store keyed by booking_id
const bookingStore: Map<string, BookingRecord> = new Map();

/**
 * Create a booking record
 */
export function createBooking(booking: Booking): BookingRecord {
  // Validate booking
  const validationResult = BookingSchema.safeParse(booking);
  if (!validationResult.success) {
    throw new Error(`Invalid booking: ${validationResult.error.errors.map((e) => e.message).join(', ')}`);
  }

  const record: BookingRecord = {
    booking: validationResult.data,
    artifacts: {},
    created_at: new Date().toISOString(),
  };

  bookingStore.set(booking.booking_id, record);

  return record;
}

/**
 * Get booking by booking_id
 */
export function getBooking(bookingId: string): BookingRecord | undefined {
  return bookingStore.get(bookingId);
}

/**
 * Update booking artifacts
 */
export function updateBookingArtifacts(bookingId: string, artifacts: Partial<BookingRecord['artifacts']>): void {
  const record = bookingStore.get(bookingId);
  if (!record) {
    throw new Error(`Booking not found: ${bookingId}`);
  }

  record.artifacts = {
    ...record.artifacts,
    ...artifacts,
  };

  // Update confirmation message IDs if provided
  if (artifacts.confirmation_message_ids) {
    record.artifacts.confirmation_message_ids = [
      ...(record.artifacts.confirmation_message_ids || []),
      ...artifacts.confirmation_message_ids,
    ];
  }
}

/**
 * Get all bookings
 */
export function getAllBookings(): BookingRecord[] {
  return Array.from(bookingStore.values());
}

// Export store for testing
export { bookingStore };



