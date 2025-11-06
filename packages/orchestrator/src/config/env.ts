import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  PUBLIC_BASE_URL: z.string().url(),
  REGION: z.string().default('us1'),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[a-f0-9]{32}$/i),
  TWILIO_API_KEY_SID: z.string().min(32), // Accept any format (can be SK prefix or other)
  TWILIO_API_KEY_SECRET: z.string().min(32),
  TWILIO_AUTH_TOKEN: z.string().min(32),
  TWILIO_VOICE_NUMBER: z.string().regex(/^\+\d{10,15}$/), // E.164 format (supports international numbers)
  COMPANY_NAME: z.string().default('Alta'),
  CALL_PURPOSE: z.string().default('to schedule a short discovery meeting'),
  FEATURE_REQUIRE_RECORDING_CONSENT: z.string().default('true').transform((v) => v === 'true'),
  TIMEZONE_DEFAULT: z.string().default('America/New_York'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid environment configuration: ${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

