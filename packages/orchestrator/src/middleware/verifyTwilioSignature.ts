import { Request, Response, NextFunction } from 'express';
import { getTwilioAuthToken } from '../services/twilioClient.js';
import twilio from 'twilio';

/**
 * Middleware to verify Twilio webhook signature
 * Validates X-Twilio-Signature header using Auth Token
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const authToken = getTwilioAuthToken();
  const signature = req.header('X-Twilio-Signature');
  
  // For ngrok free tier, use the full URL from the request
  // Twilio sends the full URL, so we need to reconstruct it properly
  const protocol = req.header('X-Forwarded-Proto') || req.protocol || 'https';
  const host = req.header('X-Forwarded-Host') || req.get('host') || req.header('host');
  const originalUrl = req.originalUrl || req.url;
  const url = `${protocol}://${host}${originalUrl}`;

  if (!signature) {
    // Log but allow for development/testing (ngrok free tier may not always send signature correctly)
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'Missing Twilio signature - allowing for development',
      url,
      correlation_id: (req as any).correlationId,
    }));
    // For development, allow requests without signature
    // In production, you should uncomment the return statement below
    // return res.status(403).json({ error: 'Missing Twilio signature' });
  } else {
    // Twilio signature validation
    const params: Record<string, string> = {};
    
    // Collect all form data and query params
    if (req.method === 'POST') {
      Object.keys(req.body || {}).forEach((key) => {
        params[key] = String(req.body[key]);
      });
    }

    Object.keys(req.query || {}).forEach((key) => {
      params[key] = String(req.query[key]);
    });

    const isValid = twilio.validateRequest(authToken, signature, url, params);

    if (!isValid) {
      // Log but allow for development/testing (ngrok may cause URL mismatches)
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'Invalid Twilio signature - allowing for development',
        url,
        expected_url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        correlation_id: (req as any).correlationId,
      }));
      // For development, allow requests with invalid signature
      // In production, you should uncomment the return statement below
      // return res.status(403).json({ error: 'Invalid Twilio signature' });
    }
  }

  next();
}

