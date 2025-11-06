import twilio from 'twilio';
import { getEnvConfig } from '../config/env.js';

let twilioClient: twilio.Twilio | null = null;

/**
 * Get or create Twilio client using API Key SID and Secret
 * Uses API Key credentials (not Auth Token) for client operations
 */
export function getTwilioClient(): twilio.Twilio {
  if (twilioClient) {
    return twilioClient;
  }

  const config = getEnvConfig();

  twilioClient = twilio(config.TWILIO_API_KEY_SID, config.TWILIO_API_KEY_SECRET, {
    accountSid: config.TWILIO_ACCOUNT_SID,
  });

  return twilioClient;
}

/**
 * Get Auth Token for webhook signature validation only
 */
export function getTwilioAuthToken(): string {
  const config = getEnvConfig();
  return config.TWILIO_AUTH_TOKEN;
}

