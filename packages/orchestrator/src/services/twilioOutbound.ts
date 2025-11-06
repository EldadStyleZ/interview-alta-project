import { z } from 'zod';
import { getTwilioClient } from './twilioClient.js';
import { getEnvConfig } from '../config/env.js';

const OutboundCallSchema = z.object({
  to: z.string().regex(/^\+\d{10,15}$/, 'Phone number must be E.164 format (+[country code][number])'),
});

export type OutboundCallRequest = z.infer<typeof OutboundCallSchema>;

export interface OutboundCallResponse {
  call_sid: string;
  status: string;
  to: string;
  from: string;
}

/**
 * Create an outbound call via Twilio
 */
export async function createOutboundCall(
  request: OutboundCallRequest,
): Promise<OutboundCallResponse> {
  // Validate request
  const validationResult = OutboundCallSchema.safeParse(request);
  if (!validationResult.success) {
    throw new Error(`Invalid request: ${validationResult.error.errors.map((e) => e.message).join(', ')}`);
  }

  const config = getEnvConfig();
  const client = getTwilioClient();

  // Build webhook URLs
  const incomingUrl = `${config.PUBLIC_BASE_URL}/twilio/voice/incoming?dir=outbound`;
  const statusCallbackUrl = `${config.PUBLIC_BASE_URL}/twilio/voice/status`;

  // Create the call
  const call = await client.calls.create({
    from: config.TWILIO_VOICE_NUMBER,
    to: validationResult.data.to,
    url: incomingUrl,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
    machineDetection: 'Enable',
    machineDetectionTimeout: 30,
  });

  // Mask phone number in response (PII minimization)
  const maskedTo = maskPhoneNumber(validationResult.data.to);

  // Mask the from number (international format support)
  const maskedFrom = maskPhoneNumber(config.TWILIO_VOICE_NUMBER);

  return {
    call_sid: call.sid,
    status: call.status,
    to: maskedTo,
    from: maskedFrom,
  };
}

/**
 * Mask phone number for logging (PII minimization)
 * Supports international numbers (E.164 format)
 */
function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 4) {
    return '***';
  }
  // Keep last 4 digits, mask the rest (works for any country code)
  const last4 = phone.slice(-4);
  const countryCode = phone.match(/^\+\d{1,3}/)?.[0] || '+';
  return `${countryCode}***-***-${last4}`;
}

