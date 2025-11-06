import { getQueuedMessages, markMessageSent, markMessageFailed, type OutboxEntry } from './outbox.js';
import { renderTemplate } from './templates.js';
import { emitConfirmationSent } from '../analytics/bus.js';

/**
 * Sent event record
 */
export interface SentEventRecord {
  message_id: string;
  channel: 'email' | 'sms';
  to: string;
  sent_at: string; // RFC 3339 UTC
  template_rendered: string;
  success: boolean;
  error?: string;
}

// In-memory sent events log
const sentEvents: SentEventRecord[] = [];

/**
 * Process a single outbox entry
 */
function processMessage(entry: OutboxEntry): SentEventRecord | null {
  const { message_id, message } = entry;

  try {
    // Render template
    const templateRendered = renderTemplate(
      message.channel,
      message.template_id,
      message.payload_json as Record<string, unknown>,
    );

    // Simulate sending (in real implementation, this would call email/SMS service)
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'message_sent',
        message_id,
        channel: message.channel,
        to: message.to,
        template_id: message.template_id,
      }),
    );

    // Mark as sent
    const marked = markMessageSent(message_id);
    if (!marked) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({ level: 'warn', msg: 'message_already_processed', message_id }));
      return null;
    }

    // Emit analytics event
    const bookingId = (message.payload_json as Record<string, unknown>)?.booking_id as string | undefined;
    if (bookingId) {
      emitConfirmationSent(message_id, bookingId, message.channel, true);
    }

    // Create sent event record
    const sentEvent: SentEventRecord = {
      message_id,
      channel: message.channel,
      to: message.to,
      sent_at: new Date().toISOString(),
      template_rendered: templateRendered,
      success: true,
    };

    sentEvents.push(sentEvent);

    return sentEvent;
  } catch (error) {
    // Mark as failed
    markMessageFailed(message_id);

    const sentEvent: SentEventRecord = {
      message_id,
      channel: message.channel,
      to: message.to,
      sent_at: new Date().toISOString(),
      template_rendered: '',
      success: false,
      error: (error as Error).message,
    };

    sentEvents.push(sentEvent);

    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'message_send_failed',
        message_id,
        error: (error as Error).message,
      }),
    );

    return sentEvent;
  }
}

/**
 * Drain the outbox - process all queued messages
 */
export function drainOutbox(): { processed: number; succeeded: number; failed: number } {
  const queued = getQueuedMessages();
  let succeeded = 0;
  let failed = 0;

  for (const entry of queued) {
    const result = processMessage(entry);
    if (result) {
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }
  }

  return {
    processed: queued.length,
    succeeded,
    failed,
  };
}

/**
 * Start background worker that processes outbox periodically
 */
let workerInterval: NodeJS.Timeout | null = null;

export function startWorker(intervalMs: number = 5000): void {
  if (workerInterval) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ level: 'warn', msg: 'worker_already_running' }));
    return;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'outbox_worker_started', interval_ms: intervalMs }));

  workerInterval = setInterval(() => {
    const result = drainOutbox();
    if (result.processed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'outbox_processed',
          processed: result.processed,
          succeeded: result.succeeded,
          failed: result.failed,
        }),
      );
    }
  }, intervalMs);
}

/**
 * Stop background worker
 */
export function stopWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: 'info', msg: 'outbox_worker_stopped' }));
  }
}

/**
 * Get all sent events
 */
export function getSentEvents(): SentEventRecord[] {
  return [...sentEvents];
}

/**
 * Get sent event by message_id
 */
export function getSentEvent(messageId: string): SentEventRecord | undefined {
  return sentEvents.find((event) => event.message_id === messageId);
}

// Export for testing
export { sentEvents };

