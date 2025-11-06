import { ConfirmationMessageSchema, type ConfirmationMessage } from '../contracts/index.js';

/**
 * Outbox for confirmation messages
 */
export interface OutboxEntry {
  message_id: string;
  message: ConfirmationMessage;
  queued_at: string; // RFC 3339 UTC
  status: 'queued' | 'sent' | 'failed';
}

// In-memory outbox store
const outbox: OutboxEntry[] = [];

/**
 * Enqueue a confirmation message to the outbox
 */
export function enqueueConfirmation(message: ConfirmationMessage): { success: boolean; message_id: string } {
  // Validate message
  const validationResult = ConfirmationMessageSchema.safeParse(message);
  if (!validationResult.success) {
    throw new Error(`Invalid confirmation message: ${validationResult.error.errors.map((e) => e.message).join(', ')}`);
  }

  const entry: OutboxEntry = {
    message_id: message.message_id,
    message: validationResult.data,
    queued_at: new Date().toISOString(),
    status: 'queued',
  };

  outbox.push(entry);

  return {
    success: true,
    message_id: message.message_id,
  };
}

/**
 * Get all queued messages
 */
export function getQueuedMessages(): OutboxEntry[] {
  return outbox.filter((entry) => entry.status === 'queued');
}

/**
 * Get all messages
 */
export function getAllMessages(): OutboxEntry[] {
  return [...outbox];
}

/**
 * Get message by message_id
 */
export function getMessage(messageId: string): OutboxEntry | undefined {
  return outbox.find((entry) => entry.message_id === messageId);
}

/**
 * Mark message as sent
 */
export function markMessageSent(messageId: string): boolean {
  const entry = outbox.find((e) => e.message_id === messageId);
  if (entry && entry.status === 'queued') {
    entry.status = 'sent';
    entry.message.delivery_status = 'sent';
    return true;
  }
  return false;
}

/**
 * Mark message as failed
 */
export function markMessageFailed(messageId: string): boolean {
  const entry = outbox.find((e) => e.message_id === messageId);
  if (entry && entry.status === 'queued') {
    entry.status = 'failed';
    entry.message.delivery_status = 'failed';
    return true;
  }
  return false;
}

// Export outbox for testing
export { outbox };


