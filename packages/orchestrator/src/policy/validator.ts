export type GateType = 'preDial' | 'inCall' | 'preBooking' | 'preWrite';

export interface PolicyCheckRequest {
  gate: GateType;
  context: Record<string, unknown>;
}

export interface PolicyCheckResponse {
  pass: boolean;
  reason?: string;
  reasonCode?: string;
}

// Pre-dial context structure
interface PreDialContext {
  lead_id: string;
  dnc_flag?: boolean;
  attempts_this_week?: number;
  last_attempt_ts?: string; // RFC 3339 UTC
  lead_timezone?: string; // IANA timezone
  current_time_utc?: string; // RFC 3339 UTC, defaults to now
}

// In-call context structure
interface InCallContext {
  call_id: string;
  consent_to_proceed?: boolean;
  recording_consent?: boolean | null; // null = not asked, true = granted, false = denied
  recording_active?: boolean;
  opt_out_detected?: boolean;
}

// Pre-booking context structure
interface PreBookingContext {
  booking_id: string;
  explicit_confirmation?: boolean;
  confirmed_date?: string; // RFC 3339 UTC
  confirmed_time?: string; // RFC 3339 UTC or time string
  qualification_flags?: Record<string, unknown>;
}

// Pre-write context structure
interface PreWriteContext {
  payload_type: 'calendar' | 'crm' | 'analytics';
  payload: Record<string, unknown>;
  idempotency_key?: string;
  region?: string;
  expected_region?: string;
}

// Helper to check if time is within 09:00-17:00 local
function isWithinCallWindow(localHour: number): boolean {
  return localHour >= 9 && localHour < 17;
}

// Helper to get hours since last attempt
function hoursSinceLastAttempt(lastAttemptTs: string, currentTs: string): number {
  const last = new Date(lastAttemptTs);
  const current = new Date(currentTs);
  return (current.getTime() - last.getTime()) / (1000 * 60 * 60);
}

// Helper to convert UTC to local hour
function getLocalHour(utcTime: string, timezone: string): number {
  // For simplicity, we'll use a basic conversion
  // In production, use a proper timezone library like date-fns-tz
  const date = new Date(utcTime);
  // Get UTC hour
  const utcHour = date.getUTCHours();
  // Basic timezone offset (this is simplified - production should use proper timezone DB)
  // For US/EU timezones, approximate offsets
  const offsets: Record<string, number> = {
    'America/New_York': -5,
    'America/Chicago': -6,
    'America/Denver': -7,
    'America/Los_Angeles': -8,
    'Europe/London': 0,
    'Europe/Paris': 1,
    'Europe/Berlin': 1,
    'Europe/Rome': 1,
  };
  const offset = offsets[timezone] || 0;
  let localHour = utcHour + offset;
  if (localHour < 0) localHour += 24;
  if (localHour >= 24) localHour -= 24;
  return localHour;
}

export function validatePreDial(context: PreDialContext): PolicyCheckResponse {
  const { dnc_flag, attempts_this_week, last_attempt_ts, lead_timezone, current_time_utc } = context;

  // Check DNC flag
  if (dnc_flag === true) {
    return {
      pass: false,
      reason: 'Lead is on do-not-call list',
      reasonCode: 'DNC_BLOCKED',
    };
  }

  // Check attempts per week
  if (attempts_this_week !== undefined && attempts_this_week >= 3) {
    return {
      pass: false,
      reason: 'Maximum attempts per week (3) exceeded',
      reasonCode: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  // Check 24-hour minimum gap
  if (last_attempt_ts) {
    const currentTime = current_time_utc || new Date().toISOString();
    const hoursSince = hoursSinceLastAttempt(last_attempt_ts, currentTime);
    if (hoursSince < 24) {
      return {
        pass: false,
        reason: `Minimum 24-hour gap not met. Last attempt was ${hoursSince.toFixed(1)} hours ago`,
        reasonCode: 'MIN_GAP_NOT_MET',
      };
    }
  }

  // Check call window (09:00-17:00 local)
  if (lead_timezone && current_time_utc) {
    const localHour = getLocalHour(current_time_utc, lead_timezone);
    if (!isWithinCallWindow(localHour)) {
      return {
        pass: false,
        reason: `Current time ${localHour}:00 is outside call window (09:00-17:00 local)`,
        reasonCode: 'OUTSIDE_CALL_WINDOW',
      };
    }
  }

  return { pass: true };
}

export function validateInCall(context: InCallContext): PolicyCheckResponse {
  const { consent_to_proceed, recording_consent, recording_active, opt_out_detected } = context;

  // Check opt-out detection
  if (opt_out_detected === true) {
    return {
      pass: false,
      reason: 'Opt-out detected during call',
      reasonCode: 'OPT_OUT_DETECTED',
    };
  }

  // Check consent to proceed (required for continuing)
  if (consent_to_proceed !== true) {
    return {
      pass: false,
      reason: 'Consent to proceed not captured',
      reasonCode: 'CONSENT_TO_PROCEED_MISSING',
    };
  }

  // Check recording consent if recording is active
  if (recording_active === true) {
    if (recording_consent !== true) {
      return {
        pass: false,
        reason: recording_consent === false
          ? 'Recording consent denied but recording is active'
          : 'Recording active but consent not obtained',
        reasonCode: 'RECORDING_CONSENT_MISSING',
      };
    }
  }

  return { pass: true };
}

export function validatePreBooking(context: PreBookingContext): PolicyCheckResponse {
  const { explicit_confirmation, confirmed_date, confirmed_time, qualification_flags } = context;

  // Check explicit verbal confirmation
  if (explicit_confirmation !== true) {
    return {
      pass: false,
      reason: 'Explicit verbal confirmation of date and time not present',
      reasonCode: 'EXPLICIT_CONFIRMATION_MISSING',
    };
  }

  // Check confirmed date and time
  if (!confirmed_date || !confirmed_time) {
    return {
      pass: false,
      reason: 'Confirmed date or time missing',
      reasonCode: 'CONFIRMED_DATETIME_MISSING',
    };
  }

  // Check qualification flags present
  if (!qualification_flags || Object.keys(qualification_flags).length === 0) {
    return {
      pass: false,
      reason: 'Qualification flags not present',
      reasonCode: 'QUALIFICATION_FLAGS_MISSING',
    };
  }

  return { pass: true };
}

export function validatePreWrite(context: PreWriteContext): PolicyCheckResponse {
  const { payload_type, payload, idempotency_key, region, expected_region } = context;

  // Check payload completeness (basic check - detailed validation done by contracts)
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return {
      pass: false,
      reason: 'Payload is empty or invalid',
      reasonCode: 'PAYLOAD_INCOMPLETE',
    };
  }

  // Check idempotency key
  if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length === 0) {
    return {
      pass: false,
      reason: 'Idempotency key missing',
      reasonCode: 'IDEMPOTENCY_KEY_MISSING',
    };
  }

  // Check region routing for calendar and CRM writes
  if (payload_type === 'calendar' || payload_type === 'crm') {
    if (!region || !expected_region) {
      return {
        pass: false,
        reason: 'Region routing information missing',
        reasonCode: 'REGION_ROUTING_MISSING',
      };
    }

    if (region !== expected_region) {
      return {
        pass: false,
        reason: `Region mismatch: expected ${expected_region}, got ${region}`,
        reasonCode: 'REGION_MISMATCH',
      };
    }
  }

  return { pass: true };
}

export function validatePolicy(gate: GateType, context: Record<string, unknown>): PolicyCheckResponse {
  switch (gate) {
    case 'preDial':
      return validatePreDial(context as unknown as PreDialContext);
    case 'inCall':
      return validateInCall(context as unknown as InCallContext);
    case 'preBooking':
      return validatePreBooking(context as unknown as PreBookingContext);
    case 'preWrite':
      return validatePreWrite(context as unknown as PreWriteContext);
    default:
      return {
        pass: false,
        reason: `Unknown gate type: ${gate}`,
        reasonCode: 'UNKNOWN_GATE',
      };
  }
}

