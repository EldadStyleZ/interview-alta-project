import { BookingSchema, type Booking } from '../contracts/index.js';
import { preWriteGate, type WritePayload } from '../contracts/index.js';

/**
 * Salesforce Task representation (mapped from Booking)
 */
export interface SalesforceTask {
  External_Id__c: string; // booking_id
  WhoId: string; // lead_id or contact_id
  OwnerId: string; // manager_id
  Subject: string; // Meeting title
  CallDisposition__c: string; // outcome
  Qualification_Flags__c: string; // JSON stringified
  Description: string | null; // notes
  Call_ID__c: string; // call_id
  Meeting_ID__c: string | null; // meeting_id if available
  CreatedDate: string; // created_ts
  Consent_Status__c: string; // consent_status
}

/**
 * Task payload from API request
 */
export interface TaskPayload {
  booking_id: string;
  lead_id: string;
  contact_id?: string | null;
  manager_id: string;
  outcome: string;
  qualification_flags: Record<string, unknown>;
  notes?: string | null;
  call_id: string;
  meeting_id?: string | null;
  created_ts: string;
  consent_status?: string;
}

// In-memory store keyed by booking_id
const taskStore: Map<string, SalesforceTask> = new Map();

/**
 * Convert Booking to Salesforce Task
 */
function bookingToTask(payload: TaskPayload): SalesforceTask {
  return {
    External_Id__c: payload.booking_id,
    WhoId: payload.contact_id || payload.lead_id,
    OwnerId: payload.manager_id,
    Subject: `Discovery Meeting - ${payload.outcome}`,
    CallDisposition__c: payload.outcome,
    Qualification_Flags__c: JSON.stringify(payload.qualification_flags),
    Description: payload.notes || null,
    Call_ID__c: payload.call_id,
    Meeting_ID__c: payload.meeting_id || null,
    CreatedDate: payload.created_ts,
    Consent_Status__c: payload.consent_status || 'not_asked',
  };
}

/**
 * Create or update a CRM task
 * Uses booking_id as external ID - duplicate writes update existing record
 */
export function upsertTask(payload: TaskPayload): { success: boolean; task?: SalesforceTask; error?: string } {
  // Validate booking structure first
  const booking: Booking = {
    booking_id: payload.booking_id,
    lead_id: payload.lead_id,
    contact_id: payload.contact_id || null,
    manager_id: payload.manager_id,
    outcome: payload.outcome as 'booked' | 'declined' | 'reschedule_requested',
    qualification_flags: payload.qualification_flags,
    notes: payload.notes || null,
    call_id: payload.call_id,
    created_ts: payload.created_ts,
  };

  // Validate using Booking schema
  const validationResult = BookingSchema.safeParse(booking);
  if (!validationResult.success) {
    return {
      success: false,
      error: `Validation failed: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
    };
  }

  // Validate using pre-write gate
  const writePayload: WritePayload = {
    type: 'crm',
    payload: booking,
  };

  const gateResult = preWriteGate(writePayload);
  if (!gateResult.valid) {
    return {
      success: false,
      error: `Pre-write validation failed: ${gateResult.errors.join(', ')}`,
    };
  }

  // Convert to Salesforce Task
  const task = bookingToTask(payload);

  // Upsert: if booking_id exists, update; otherwise create
  const existing = taskStore.get(payload.booking_id);
  if (existing) {
    // Update existing record
    taskStore.set(payload.booking_id, task);
    return {
      success: true,
      task,
    };
  } else {
    // Create new record
    taskStore.set(payload.booking_id, task);
    return {
      success: true,
      task,
    };
  }
}

/**
 * Get task by booking_id
 */
export function getTask(bookingId: string): SalesforceTask | undefined {
  return taskStore.get(bookingId);
}

/**
 * Get all tasks
 */
export function getAllTasks(): SalesforceTask[] {
  return Array.from(taskStore.values());
}

// Export store for testing
export { taskStore };

