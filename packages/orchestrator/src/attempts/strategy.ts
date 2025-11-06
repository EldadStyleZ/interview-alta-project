/**
 * Attempts strategy and scheduling
 * Implements: 3 attempts per week, 24 hour spacing, voicemail on attempt 2 only,
 * best time windows by region, busy retry after 15 minutes
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Attempt record
 */
export interface AttemptRecord {
  attempt_id: string;
  lead_id: string;
  attempt_no: number;
  timestamp: string; // RFC 3339 UTC
  outcome: 'answered' | 'no_answer' | 'busy' | 'voicemail' | 'failed' | 'opt_out';
  region?: string;
  call_id?: string;
}

/**
 * Attempt scheduling result
 */
export interface ScheduleResult {
  eligible: boolean;
  next_attempt_ts?: string; // RFC 3339 UTC
  block_reason?: string;
  attempt_no?: number;
  retry_after_ts?: string; // For busy retries
}

/**
 * Region-based time windows (UTC)
 */
const REGION_TIME_WINDOWS: Record<string, { start: number; end: number }> = {
  US_EAST: { start: 13, end: 21 }, // 9 AM - 5 PM EST (UTC-5)
  US_WEST: { start: 17, end: 1 }, // 9 AM - 5 PM PST (UTC-8), wraps to next day
  EU: { start: 8, end: 16 }, // 9 AM - 5 PM CET (UTC+1)
  APAC: { start: 0, end: 8 }, // 9 AM - 5 PM JST (UTC+9), wraps to previous day
  DEFAULT: { start: 13, end: 21 }, // Default US East
};

/**
 * In-memory attempt store
 */
const attemptStore = new Map<string, AttemptRecord[]>();

/**
 * Get attempts for a lead
 */
export function getAttempts(leadId: string): AttemptRecord[] {
  return attemptStore.get(leadId) || [];
}

/**
 * Record an attempt
 */
export function recordAttempt(attempt: Omit<AttemptRecord, 'attempt_id'>): AttemptRecord {
  const attempts = getAttempts(attempt.lead_id);
  const newAttempt: AttemptRecord = {
    ...attempt,
    attempt_id: uuidv4(),
  };

  attempts.push(newAttempt);
  attemptStore.set(attempt.lead_id, attempts);

  return newAttempt;
}

/**
 * Get attempts within a time window (for weekly counting)
 */
function getAttemptsInWindow(attempts: AttemptRecord[], windowStart: Date, windowEnd: Date): AttemptRecord[] {
  return attempts.filter((attempt) => {
    const attemptTime = new Date(attempt.timestamp);
    return attemptTime >= windowStart && attemptTime < windowEnd;
  });
}

/**
 * Get attempts in the current week (Monday to Sunday)
 */
function getAttemptsThisWeek(attempts: AttemptRecord[]): AttemptRecord[] {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7)); // Get Monday
  monday.setUTCHours(0, 0, 0, 0);

  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);

  return getAttemptsInWindow(attempts, monday, nextMonday);
}

/**
 * Get the last attempt
 */
function getLastAttempt(attempts: AttemptRecord[]): AttemptRecord | undefined {
  if (attempts.length === 0) {
    return undefined;
  }

  // Sort by timestamp descending
  const sorted = [...attempts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return sorted[0];
}

/**
 * Check if 24 hours have passed since last attempt
 */
function has24HourSpacing(lastAttempt: AttemptRecord, now: Date): boolean {
  const lastAttemptTime = new Date(lastAttempt.timestamp);
  const diffMs = now.getTime() - lastAttemptTime.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= 24;
}

/**
 * Get next attempt number
 */
function getNextAttemptNo(attempts: AttemptRecord[]): number {
  if (attempts.length === 0) {
    return 1;
  }

  const lastAttempt = getLastAttempt(attempts);
  return (lastAttempt?.attempt_no || 0) + 1;
}

/**
 * Check if voicemail is allowed for this attempt
 */
function isVoicemailAllowed(attemptNo: number): boolean {
  return attemptNo === 2;
}

/**
 * Get best time window for a region
 */
function getTimeWindow(region: string = 'DEFAULT'): { start: number; end: number } {
  return REGION_TIME_WINDOWS[region] || REGION_TIME_WINDOWS.DEFAULT;
}

/**
 * Calculate next available time within the time window
 */
function getNextTimeInWindow(now: Date, window: { start: number; end: number }): Date {
  const nextTime = new Date(now);
  const currentHour = nextTime.getUTCHours();

  // Handle wrapping windows (end < start, e.g., US_WEST: 17:00 to 01:00)
  if (window.end < window.start) {
    // Window wraps to next day
    if (currentHour >= window.start || currentHour < window.end) {
      // We're in the window
      nextTime.setUTCMinutes(nextTime.getUTCMinutes() + 1, 0, 0);
      return nextTime;
    } else {
      // We're after the window end but before window start
      // Check if we're closer to today's start or tomorrow's start
      if (currentHour >= window.end) {
        // We're after window end, schedule for today at window start
        nextTime.setUTCHours(window.start, 0, 0, 0);
        return nextTime;
      } else {
        // We're before window start, schedule for today
        nextTime.setUTCHours(window.start, 0, 0, 0);
        return nextTime;
      }
    }
  }

  // Normal window (end > start)
  // If we're before the window, schedule for today
  if (currentHour < window.start) {
    nextTime.setUTCHours(window.start, 0, 0, 0);
    return nextTime;
  }

  // If we're in the window, schedule for now (or next available minute)
  if (currentHour < window.end) {
    nextTime.setUTCMinutes(nextTime.getUTCMinutes() + 1, 0, 0);
    return nextTime;
  }

  // If we're after the window, schedule for tomorrow at window start
  nextTime.setUTCDate(nextTime.getUTCDate() + 1);
  nextTime.setUTCHours(window.start, 0, 0, 0);
  return nextTime;
}

/**
 * Handle busy retry logic
 */
function getBusyRetryTime(lastAttempt: AttemptRecord, now: Date): Date | undefined {
  if (lastAttempt.outcome !== 'busy') {
    return undefined;
  }

  const lastAttemptTime = new Date(lastAttempt.timestamp);
  const diffMs = now.getTime() - lastAttemptTime.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  // If less than 15 minutes have passed, schedule retry
  if (diffMinutes < 15) {
    const retryTime = new Date(lastAttemptTime);
    retryTime.setUTCMinutes(retryTime.getUTCMinutes() + 15);
    return retryTime;
  }

  return undefined;
}

/**
 * Schedule next attempt for a lead
 */
export function scheduleAttempt(leadId: string, region: string = 'DEFAULT', currentTime?: Date): ScheduleResult {
  const now = currentTime || new Date();
  const attempts = getAttempts(leadId);
  const attemptsThisWeek = getAttemptsThisWeek(attempts);
  const lastAttempt = getLastAttempt(attempts);

  // Check weekly limit (3 attempts per week)
  if (attemptsThisWeek.length >= 3) {
    // Calculate next Monday
    const dayOfWeek = now.getUTCDay();
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7)); // Get Monday
    monday.setUTCDate(monday.getUTCDate() + 7); // Next Monday
    monday.setUTCHours(0, 0, 0, 0);

    const window = getTimeWindow(region);
    const nextTime = getNextTimeInWindow(monday, window);

    return {
      eligible: false,
      block_reason: 'WEEKLY_LIMIT_EXCEEDED',
      next_attempt_ts: nextTime.toISOString(),
    };
  }

  // Check for busy retry (within 15 minutes)
  if (lastAttempt) {
    const busyRetry = getBusyRetryTime(lastAttempt, now);
    if (busyRetry && busyRetry > now) {
      return {
        eligible: true,
        next_attempt_ts: busyRetry.toISOString(),
        attempt_no: lastAttempt.attempt_no, // Same attempt number for retry
        retry_after_ts: busyRetry.toISOString(),
      };
    }
  }

  // Check 24 hour spacing (but allow busy retries to bypass this)
  if (lastAttempt && !has24HourSpacing(lastAttempt, now)) {
    // Check if this is a busy retry (should bypass 24 hour rule)
    const isBusyRetry = lastAttempt.outcome === 'busy' && getBusyRetryTime(lastAttempt, now) !== undefined;
    
    if (!isBusyRetry) {
      const nextTime = new Date(lastAttempt.timestamp);
      nextTime.setUTCHours(nextTime.getUTCHours() + 24);

      // Ensure next time is within time window
      const window = getTimeWindow(region);
      const windowedTime = getNextTimeInWindow(nextTime, window);

      return {
        eligible: false,
        block_reason: 'INSUFFICIENT_SPACING',
        next_attempt_ts: windowedTime.toISOString(),
        attempt_no: getNextAttemptNo(attempts),
      };
    }
  }

  // Check if we can call now (within time window)
  const window = getTimeWindow(region);
  const currentHour = now.getUTCHours();
  
  // Handle wrapping windows (end < start)
  let canCallNow: boolean;
  if (window.end < window.start) {
    // Window wraps to next day (e.g., 17:00 to 01:00)
    canCallNow = currentHour >= window.start || currentHour < window.end;
  } else {
    // Normal window
    canCallNow = currentHour >= window.start && currentHour < window.end;
  }

  if (canCallNow) {
    return {
      eligible: true,
      next_attempt_ts: now.toISOString(),
      attempt_no: getNextAttemptNo(attempts),
    };
  }

  // Schedule for next available time in window
  const nextTime = getNextTimeInWindow(now, window);

  return {
    eligible: false,
    block_reason: 'OUTSIDE_TIME_WINDOW',
    next_attempt_ts: nextTime.toISOString(),
    attempt_no: getNextAttemptNo(attempts),
  };
}

/**
 * Check if voicemail is allowed for the next attempt
 */
export function isVoicemailAllowedForLead(leadId: string): boolean {
  const attempts = getAttempts(leadId);
  const nextAttemptNo = getNextAttemptNo(attempts);
  return isVoicemailAllowed(nextAttemptNo);
}

/**
 * Clear attempts for a lead (for testing)
 */
export function clearAttempts(leadId: string): void {
  attemptStore.delete(leadId);
}

// Export for testing
export { attemptStore, getAttemptsThisWeek, getTimeWindow, has24HourSpacing };

