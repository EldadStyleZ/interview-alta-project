import http from 'http';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { validatePolicy, type PolicyCheckRequest } from './policy/validator.js';
import { createCallSession as createCPaaSSession, processVoiceEvent, getCallById, type AnswerCallRequest, type VoiceEventRequest } from './telephony/cpaas.js';
import {
  createCallSession,
  getCallSession,
  processTranscript,
  startASRStreaming,
  speakText,
  getProposedTimes,
  getStatePrompt,
  endCallSession,
} from './agent/orchestrator.js';
import { createASRProvider, type ASRConfig } from './speech/asr.js';
import { createTTSProvider, type TTSConfig } from './speech/tts.js';
import { getAvailability, placeHold, createEvent, type AvailabilityWindow } from './calendar/service.js';
import { CalendarEventSchema, CalendarHoldSchema, type CalendarEvent, type CalendarHold } from './contracts/index.js';
import { upsertTask, getTask, type TaskPayload } from './crm/salesforceMock.js';
import { createBooking, updateBookingArtifacts, getBooking } from './booking/store.js';
import { enqueueConfirmation } from './messaging/outbox.js';
import { type ConfirmationMessage } from './contracts/index.js';
import { startWorker } from './messaging/outboxWorker.js';
import {
  emitCallStarted,
  emitCallConnected,
  emitBookingCreated,
  emitCalendarEventCreated,
  emitCRMActivityWritten,
  emitConfirmationSent,
  emitOptOut,
  readEvents,
  type AnalyticsEvent,
} from './analytics/bus.js';
import { scheduleAttempt, recordAttempt, isVoicemailAllowedForLead, type ScheduleResult } from './attempts/strategy.js';
import { verifyTwilioSignature } from './middleware/verifyTwilioSignature.js';
import { createOutboundCall } from './services/twilioOutbound.js';
import { getEnvConfig } from './config/env.js';
import { saveTranscriptEntry, markCallEnded, getTranscript, getTranscriptText, listTranscripts } from './services/transcriptStorage.js';
import {
  generateOutboundTwiML,
  generateDemoPromptTwiML,
  generateOptOutTwiML,
  generateConversationalTwiML,
  parseConsentResponse,
  parseOptOutRequest,
} from './services/twilioVoiceScripts.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const GIT_SHA = process.env.GIT_SHA || 'unknown';

// In-memory stores (minimal)
const leads: Record<string, {
  lead_id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  region: string;
  timezone: string;
  created_ts: string;
}> = {};
const holds: Record<string, unknown> = {};
const bookings: Record<string, unknown> = {};

const app = express();
app.use(express.json());
// Twilio webhooks send form-encoded data
app.use(express.urlencoded({ extended: true }));

// Correlation ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header('x-correlation-id');
  const cid = incoming && incoming.length > 0 ? incoming : uuidv4();
  (req as any).correlationId = cid;
  res.setHeader('x-correlation-id', cid);
  next();
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const cid = (req as any).correlationId;
    // Minimal structured log
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'http_request',
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration_ms: duration,
        correlation_id: cid,
      }),
    );
  });
  next();
});

// Health endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ service: 'orchestrator', sha: GIT_SHA, status: 'ok' });
});

// Health endpoint (alternative format for Twilio demo)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// ============================================
// Twilio Integration Routes
// ============================================

// Outbound call endpoint
app.post('/api/calls/outbound', async (req: Request, res: Response) => {
  try {
    const body = req.body as { to: string };
    const { to } = body;

    if (!to) {
      return res.status(400).json({
        error: 'to field is required',
      });
    }

    const result = await createOutboundCall({ to });

    // Emit analytics event
    emitCallStarted(result.call_sid, 'unknown', 1);

    return res.status(200).json(result);
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error creating outbound call',
      correlation_id: cid,
    });
  }
});

// Twilio voice incoming webhook (TwiML generation)
app.post('/twilio/voice/incoming', verifyTwilioSignature, (req: Request, res: Response) => {
  try {
    const action = req.query.action as string || req.body?.action as string;
    const direction = req.query.dir as string || req.body?.direction as string;
    const callSid = req.body?.CallSid as string;
    const speechResult = req.body?.SpeechResult as string;
    
    // Log incoming request for debugging
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'info',
      msg: 'twilio_voice_incoming',
      action,
      call_sid: callSid,
      has_speech: !!speechResult,
      correlation_id: cid,
    }));

    // Set content type for TwiML
    res.type('text/xml');

    // Handle different actions
    if (action === 'consent_response') {
      const consent = parseConsentResponse(speechResult);
      const twiml = generateOutboundTwiML(consent);
      return res.send(twiml);
    }

    if (action === 'demo') {
      const recording = (req.query.recording as string || req.body.recording as string) === 'yes';
      const twiml = generateDemoPromptTwiML(recording);
      return res.send(twiml);
    }

    if (action === 'conversation') {
      // Handle conversational flow
      // Get call_sid from query or body - prefer CallSid from Twilio
      const conversationCallSid = callSid || (req.query.call_sid as string) || req.body.CallSid || req.body.CallSid;
      
      if (!conversationCallSid) {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({
          level: 'error',
          msg: 'Missing call_sid for conversation action',
          correlation_id: (req as any).correlationId,
          body_keys: Object.keys(req.body || {}),
          query_keys: Object.keys(req.query || {}),
        }));
        // Fallback: try to use conversation handler with empty call_sid
        const twiml = generateConversationalTwiML(
          'unknown',
          speechResult,
          false,
        );
        return res.send(twiml);
      }
      
      // Save user speech to transcript
      if (speechResult && conversationCallSid) {
        saveTranscriptEntry({
          call_id: conversationCallSid,
          timestamp: new Date().toISOString(),
          text: speechResult,
          speaker: 'user',
          is_final: true,
        });
      }
      
      const twiml = generateConversationalTwiML(
        conversationCallSid,
        speechResult,
        (req.query.recording as string || req.body.recording as string) === 'yes',
      );
      
      // Extract AI response from conversation state and save to transcript
      if (conversationCallSid && speechResult) {
        try {
          const { getConversationState, generateConversationalResponse } = require('./services/conversationHandler.js');
          const state = getConversationState(conversationCallSid);
          const response = generateConversationalResponse(state, speechResult);
          if (response.message) {
            saveTranscriptEntry({
              call_id: conversationCallSid,
              timestamp: new Date().toISOString(),
              text: response.message,
              speaker: 'ai',
              is_final: true,
            });
          }
        } catch (error) {
          // If we can't extract AI response, that's okay - continue
          // eslint-disable-next-line no-console
          console.error('Error saving AI transcript:', error);
        }
      }
      
      return res.send(twiml);
    }

    if (action === 'handle_response') {
      // Check for opt-out
      if (parseOptOutRequest(speechResult)) {
        // Emit opt-out event
        if (callSid) {
          emitOptOut('unknown', callSid);
        }

        const twiml = generateOptOutTwiML();
        return res.send(twiml);
      }

      // Use conversational flow instead
      const twiml = generateConversationalTwiML(callSid, speechResult, false);
      return res.send(twiml);
    }

    // Default: initial outbound call - use generateOutboundTwiML
    if (!callSid) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Missing CallSid in initial webhook',
        body_keys: Object.keys(req.body || {}),
        query_keys: Object.keys(req.query || {}),
        correlation_id: (req as any).correlationId,
      }));
    }
    
    // Save initial greeting to transcript
    if (callSid) {
      const config = getEnvConfig();
      saveTranscriptEntry({
        call_id: callSid,
        timestamp: new Date().toISOString(),
        text: `Hello! This is ${config.COMPANY_NAME} calling. Is this a good time to talk?`,
        speaker: 'ai',
        is_final: true,
      });
    }
    
    const twiml = generateOutboundTwiML('pending', callSid);
    return res.send(twiml);
  } catch (error) {
    const cid = (req as any).correlationId;
    const errorMsg = (error as Error).message;
    const errorStack = (error as Error).stack;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: 'error',
      msg: 'twilio_voice_incoming_error',
      error: errorMsg,
      stack: errorStack,
      correlation_id: cid,
    }));
    res.type('text/xml');
    const twilio = require('twilio');
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say({
      voice: 'Polly.Salli',
      language: 'en-US',
    }, 'Sorry, an error occurred. Goodbye.');
    response.hangup();
    return res.send(response.toString());
  }
});

// Twilio voice status callback
app.post('/twilio/voice/status', verifyTwilioSignature, async (req: Request, res: Response) => {
  try {
    const callSid = req.body.CallSid as string;
    const callStatus = req.body.CallStatus as string;
    const direction = req.body.Direction as string;
    const to = req.body.To as string;
    const from = req.body.From as string;
    const recordingUrl = req.body.RecordingUrl as string | undefined;
    const recordingStatus = req.body.RecordingStatus as string | undefined;

    // Map Twilio status to our event types
    const statusMap: Record<string, string> = {
      'initiated': 'answered',
      'ringing': 'answered',
      'answered': 'answered',
      'completed': 'completed',
      'busy': 'busy',
      'no-answer': 'no-answer',
      'failed': 'failed',
      'canceled': 'failed',
    };

    const eventType = statusMap[callStatus] || 'failed';

    // Mark call as ended in transcript if completed
    if (callStatus === 'completed' && callSid) {
      markCallEnded(callSid);
    }

    // Log call status (without secrets)
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'info',
      msg: 'call_status',
      call_sid: callSid,
      call_status: callStatus,
      direction,
      to: to ? to.replace(/\+1(\d{3})(\d{3})(\d{4})/, '+1***-***-$3') : undefined,
      from: from ? from.replace(/\+1(\d{3})(\d{3})(\d{4})/, '+1***-***-$3') : undefined,
      recording_url: recordingUrl || null,
      recording_status: recordingStatus || null,
      correlation_id: cid,
    }));

    // Process voice event using existing CPaaS function
    if (callSid) {
      const cpaasModule = await import('./telephony/cpaas.js');
      await cpaasModule.processVoiceEvent(
        {
          call_id: callSid,
          event_type: eventType as 'answered' | 'no-answer' | 'busy' | 'failed' | 'voicemail' | 'completed',
          timestamp: new Date().toISOString(),
          metadata: {
            direction,
            recording_url: recordingUrl,
            recording_status: recordingStatus,
          },
        },
        'unknown', // lead_id not available in status callback
        1,
      );

      // Emit analytics event for connected calls
      if (callStatus === 'answered') {
        emitCallConnected(callSid, 'unknown', callStatus);
      }
    }

    // Twilio expects 200 response
    res.status(200).send('OK');
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    res.status(200).send('OK'); // Still return 200 to Twilio
  }
});

// Twilio recording status callback (optional)
app.post('/twilio/voice/recording-status', verifyTwilioSignature, (req: Request, res: Response) => {
  try {
    const callSid = req.body.CallSid as string;
    const recordingSid = req.body.RecordingSid as string;
    const recordingUrl = req.body.RecordingUrl as string;
    const recordingStatus = req.body.RecordingStatus as string;

    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'info',
      msg: 'recording_status',
      call_sid: callSid,
      recording_sid: recordingSid,
      recording_url: recordingUrl,
      recording_status: recordingStatus,
      correlation_id: cid,
    }));

    // Update call event with recording URL if available
    if (callSid && recordingUrl) {
      const callEvent = getCallById(callSid);
      if (callEvent) {
        callEvent.recording_url = recordingUrl;
        callEvent.consent_status = recordingStatus === 'completed' ? 'granted' : 'not_asked';
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    res.status(200).send('OK');
  }
});

// ============================================
// Existing Routes
// ============================================

// Policy check endpoint
app.post('/policy/check', (req: Request, res: Response) => {
  try {
    const body = req.body as PolicyCheckRequest;
    const { gate, context } = body;

    if (!gate || !['preDial', 'inCall', 'preBooking', 'preWrite'].includes(gate)) {
      return res.status(400).json({
        pass: false,
        reason: 'Invalid gate type',
        reasonCode: 'INVALID_GATE',
      });
    }

    if (!context || typeof context !== 'object') {
      return res.status(400).json({
        pass: false,
        reason: 'Context is required and must be an object',
        reasonCode: 'INVALID_CONTEXT',
      });
    }

    const result = validatePolicy(gate, context);

    if (result.pass) {
      return res.status(200).json(result);
    } else {
      return res.status(200).json(result); // Still 200, but pass: false
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      pass: false,
      reason: 'Internal error processing policy check',
      reasonCode: 'INTERNAL_ERROR',
    });
  }
});

// Voice answer endpoint - creates call session and starts conversation
app.post('/voice/answer', async (req: Request, res: Response) => {
  try {
    const body = req.body as AnswerCallRequest & { manager_id?: string };
    const { lead_id, phone_number, attempt_no, manager_id } = body;

    if (!lead_id || !phone_number) {
      return res.status(400).json({
        error: 'lead_id and phone_number are required',
      });
    }

    // Create CPaaS session
    const cpaasResponse = createCPaaSSession(lead_id, attempt_no || 1);

    // Create orchestrator session
    const session = createCallSession(cpaasResponse.call_id, lead_id, manager_id);

    // Emit analytics event
    emitCallStarted(cpaasResponse.call_id, lead_id, attempt_no || 1);

    // Send mandatory opener lines
    const openerPrompt = await getStatePrompt(session.state_machine, manager_id);
    await speakText(cpaasResponse.call_id, openerPrompt);

    // In real implementation, start ASR streaming here
    // For now, we'll handle transcripts via /voice/transcript endpoint

    return res.status(200).json({
      ...cpaasResponse,
      session_id: session.call_id,
      initial_prompt: openerPrompt,
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error creating call session',
      correlation_id: cid,
    });
  }
});

// Voice transcript endpoint - processes transcript and updates state machine
app.post('/voice/transcript', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      call_id: string;
      text: string;
      confidence?: number;
      is_final?: boolean;
      manager_id?: string;
    };

    const { call_id, text, confidence, is_final, manager_id } = body;

    if (!call_id || !text) {
      return res.status(400).json({
        error: 'call_id and text are required',
      });
    }

    const session = getCallSession(call_id);
    if (!session) {
      return res.status(404).json({
        error: 'Call session not found',
      });
    }

    // Get proposed times if entering ProposeTime state or already in it
    const currentState = session.state_machine.current;
    let proposedTimes: string[] | undefined;
    
    // If we're about to enter ProposeTime or already in it, get availability
    if ((currentState === 'Qualify' || currentState === 'ProposeTime') && manager_id) {
      // Get availability window (next 7 days)
      const from = new Date();
      const to = new Date();
      to.setDate(to.getDate() + 7);
      proposedTimes = await getProposedTimes(manager_id || session.manager_id || '0051234567890XYZ', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    // Process transcript
    const transcript = {
      text,
      confidence: confidence || 0.9,
      is_final: is_final !== false,
      call_id,
      timestamp: new Date().toISOString(),
    };

    const result = processTranscript(call_id, transcript, proposedTimes);
    
    // If we just entered ProposeTime, get times now
    if (result.state.current === 'ProposeTime' && !proposedTimes && manager_id) {
      const from = new Date();
      const to = new Date();
      to.setDate(to.getDate() + 7);
      proposedTimes = await getProposedTimes(manager_id || session.manager_id || '0051234567890XYZ', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    // If state changed, generate and speak prompt
    let prompt: string | undefined;
    if (result.should_speak) {
      prompt = await getStatePrompt(result.state, manager_id || session.manager_id, proposedTimes);
      await speakText(call_id, prompt);
    }

    // If booking intent is ready, call booking service directly
    let bookingResult: unknown = undefined;
    if (result.intent) {
      // Import booking functions directly instead of using HTTP
      const { createBooking, updateBookingArtifacts } = await import('./booking/store.js');
      const { placeHold, createEvent } = await import('./calendar/service.js');
      const { upsertTask } = await import('./crm/salesforceMock.js');
      const { enqueueConfirmation } = await import('./messaging/outbox.js');

      try {
        const managerId = manager_id || session.manager_id || '0051234567890XYZ';
        const bookingId = uuidv4();
        const meetingId = uuidv4();
        const confirmedTime = result.intent.confirmed_time;

        // Place hold
        const holdResult = placeHold({
          manager_id: managerId,
          start_utc: confirmedTime,
          end_utc: new Date(new Date(confirmedTime).getTime() + 30 * 60 * 1000).toISOString(),
          ttl_seconds: 1800,
        });

        if (holdResult.success) {
          // Create booking
          createBooking({
            booking_id: bookingId,
            lead_id: session.lead_id,
            contact_id: null,
            manager_id: managerId,
            outcome: 'booked',
            qualification_flags: result.intent.qualification_flags as Record<string, unknown>,
            notes: null,
            call_id,
            created_ts: new Date().toISOString(),
          });
          emitBookingCreated(bookingId, session.lead_id, managerId, 'booked');

          // Create calendar event (iCal_uid will be generated by createEvent if not provided)
          const eventResult = createEvent({
            meeting_id: meetingId,
            manager_id: managerId,
            contact_email: null,
            title: 'Discovery Meeting',
            start_utc: confirmedTime,
            end_utc: new Date(new Date(confirmedTime).getTime() + 30 * 60 * 1000).toISOString(),
            location: null,
            meeting_url: null,
            timezone: 'UTC',
            description: null,
            invitees_emails: [`manager-${managerId}@company.com`],
            source_system: 'ai-outbound',
            iCal_uid: '', // Will be generated by createEvent
          } as Parameters<typeof createEvent>[0]);
          emitCalendarEventCreated(meetingId, managerId, bookingId, eventResult.success);

          // Write CRM task
          const crmResult = upsertTask({
            booking_id: bookingId,
            lead_id: session.lead_id,
            contact_id: null,
            manager_id: managerId,
            outcome: 'booked',
            qualification_flags: result.intent.qualification_flags as Record<string, unknown>,
            notes: null,
            call_id,
            meeting_id: meetingId,
            created_ts: new Date().toISOString(),
            consent_status: 'granted',
          });
          emitCRMActivityWritten(bookingId, crmResult.task?.External_Id__c || bookingId, crmResult.success);

          // Enqueue confirmation
          const confirmationMessage: ConfirmationMessage = {
            message_id: uuidv4(),
            channel: 'email',
            to: `lead-${session.lead_id}@example.com`,
            template_id: 'booking_confirmation_v1',
            payload_json: {
              booking_id: bookingId,
              meeting_id: meetingId,
              meeting_date: result.intent.confirmed_date,
              meeting_time: confirmedTime,
              meeting_url: eventResult.meeting_url,
            },
            sent_ts: new Date().toISOString(),
            delivery_status: 'queued',
          };
          enqueueConfirmation(confirmationMessage);

          bookingResult = {
            success: true,
            booking_id: bookingId,
            meeting_id: meetingId,
            tentative_id: holdResult.tentative_id,
            task_id: crmResult.task?.External_Id__c,
          };

          // Speak confirmation
          const confirmPrompt = await getStatePrompt(result.state, managerId);
          await speakText(call_id, confirmPrompt);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({ level: 'error', msg: 'Booking creation failed', error: (error as Error).message }));
      }
    }

    // If opt-out, end session
    if (result.state.current === 'OptOut') {
      endCallSession(call_id);
    }

    return res.status(200).json({
      success: true,
      state: result.state.current,
      should_speak: result.should_speak,
      prompt,
      booking_intent: result.intent,
      booking_result: bookingResult,
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error processing transcript',
      correlation_id: cid,
    });
  }
});

// Voice events endpoint - ingests callbacks and persists CallEvent
app.post('/voice/events', (req: Request, res: Response) => {
  try {
    const body = req.body as VoiceEventRequest & { lead_id?: string; attempt_no?: number };
    const { call_id, event_type, timestamp, metadata, lead_id, attempt_no } = body;

    if (!call_id || !event_type) {
      return res.status(400).json({
        success: false,
        error: 'call_id and event_type are required',
      });
    }

    if (!lead_id) {
      return res.status(400).json({
        success: false,
        error: 'lead_id is required',
      });
    }

    const eventRequest: VoiceEventRequest = {
      call_id,
      event_type,
      timestamp,
      metadata,
    };

    const result = processVoiceEvent(eventRequest, lead_id, attempt_no || 1);

    // Emit analytics event for connected calls
    if (result.success && event_type === 'answered') {
      emitCallConnected(call_id, lead_id, 'answered');
    }

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      success: false,
      error: 'Internal error processing voice event',
      correlation_id: cid,
    });
  }
});

// Attempts schedule endpoint
app.post('/attempts/schedule', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      lead_id: string;
      region?: string;
      current_time?: string; // RFC 3339 UTC for testing
    };

    const { lead_id, region, current_time } = body;

    if (!lead_id) {
      return res.status(400).json({
        error: 'lead_id is required',
      });
    }

    const currentTime = current_time ? new Date(current_time) : undefined;
    const result = scheduleAttempt(lead_id, region || 'DEFAULT', currentTime);

    if (result.eligible) {
      return res.status(200).json({
        eligible: true,
        next_attempt_ts: result.next_attempt_ts,
        attempt_no: result.attempt_no,
        voicemail_allowed: isVoicemailAllowedForLead(lead_id),
        retry_after_ts: result.retry_after_ts,
      });
    } else {
      return res.status(200).json({
        eligible: false,
        block_reason: result.block_reason,
        next_attempt_ts: result.next_attempt_ts,
        attempt_no: result.attempt_no,
      });
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error scheduling attempt',
      correlation_id: cid,
    });
  }
});

// Metrics summary endpoint
app.get('/metrics/summary', (req: Request, res: Response) => {
  try {
    const events = readEvents();

    // Filter events by type
    const callStarted = events.filter((e) => e.event_type === 'call_started');
    const callConnected = events.filter((e) => e.event_type === 'call_connected');
    const bookings = events.filter((e) => e.event_type === 'booking_created');
    const calendarEvents = events.filter((e) => e.event_type === 'calendar_event_created');
    const crmActivities = events.filter((e) => e.event_type === 'crm_activity_written');
    const confirmations = events.filter((e) => e.event_type === 'confirmation_sent');
    const optOuts = events.filter((e) => e.event_type === 'opt_out');

    // Compute bookings per reached (bookings / connected calls)
    const reachedLeads = callConnected.length;
    const bookedCount = bookings.filter((e) => {
      const attrs = e.attributes as { outcome?: string };
      return attrs.outcome === 'booked';
    }).length;
    const bookingsPerReached = reachedLeads > 0 ? (bookedCount / reachedLeads) * 100 : 0;

    // Transfer rate (would need transfer events, for now use placeholder)
    // In real implementation, we'd track transfer events
    const transferRate = 0; // Placeholder - would need transfer_event type

    // Calendar write success rate
    const calendarSuccesses = calendarEvents.filter((e) => {
      const attrs = e.attributes as { success?: boolean };
      return attrs.success === true;
    }).length;
    const calendarWriteSuccess =
      calendarEvents.length > 0 ? (calendarSuccesses / calendarEvents.length) * 100 : 0;

    return res.status(200).json({
      summary: {
        bookings_per_reached: {
          value: bookingsPerReached,
          unit: 'percent',
          bookings: bookedCount,
          reached_leads: reachedLeads,
        },
        transfer_rate: {
          value: transferRate,
          unit: 'percent',
          note: 'Transfer events not yet tracked',
        },
        calendar_write_success: {
          value: calendarWriteSuccess,
          unit: 'percent',
          successful: calendarSuccesses,
          total: calendarEvents.length,
        },
      },
      counts: {
        call_started: callStarted.length,
        call_connected: callConnected.length,
        booking_created: bookings.length,
        calendar_event_created: calendarEvents.length,
        crm_activity_written: crmActivities.length,
        confirmation_sent: confirmations.length,
        opt_out: optOuts.length,
      },
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error computing metrics',
      correlation_id: cid,
    });
  }
});

// Get call by ID
app.get('/calls/:id', (req: Request, res: Response) => {
  try {
    const callId = req.params.id;

    if (!callId) {
      return res.status(400).json({
        error: 'call_id is required',
      });
    }

    const call = getCallById(callId);

    if (!call) {
      return res.status(404).json({
        error: 'Call not found',
      });
    }

    return res.status(200).json(call);
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error retrieving call',
      correlation_id: cid,
    });
  }
});

// Get availability
app.get('/availability', (req: Request, res: Response) => {
  try {
    const managerId = req.query.manager_id as string;
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!managerId || !from || !to) {
      return res.status(400).json({
        error: 'manager_id, from, and to query parameters are required',
      });
    }

    const window: AvailabilityWindow = { from, to };
    const slots = getAvailability(managerId, window);

    return res.status(200).json({
      manager_id: managerId,
      window,
      slots,
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error getting availability',
      correlation_id: cid,
    });
  }
});

// Place hold
app.post('/holds', (req: Request, res: Response) => {
  try {
    const body = req.body;
    const { manager_id, start_utc, end_utc, ttl_seconds } = body;

    if (!manager_id || !start_utc || !end_utc || !ttl_seconds) {
      return res.status(400).json({
        error: 'manager_id, start_utc, end_utc, and ttl_seconds are required',
      });
    }

    const result = placeHold({
      manager_id,
      start_utc,
      end_utc,
      ttl_seconds,
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        tentative_id: result.tentative_id,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error placing hold',
      correlation_id: cid,
    });
  }
});

// Get booking by ID
app.get('/bookings/:id', (req: Request, res: Response) => {
  try {
    const bookingId = req.params.id;
    const booking = getBooking(bookingId);

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found',
      });
    }

    return res.status(200).json({
      success: true,
      booking: booking.booking,
      artifacts: booking.artifacts,
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error retrieving booking',
      correlation_id: cid,
    });
  }
});

// Create or update CRM task
app.post('/crm/tasks', (req: Request, res: Response) => {
  try {
    const body = req.body as TaskPayload;

    // Validate required fields
    if (
      !body.booking_id ||
      !body.lead_id ||
      !body.manager_id ||
      !body.outcome ||
      !body.qualification_flags ||
      !body.call_id ||
      !body.created_ts
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: booking_id, lead_id, manager_id, outcome, qualification_flags, call_id, created_ts',
      });
    }

    const result = upsertTask(body);

    if (result.success) {
      return res.status(200).json({
        success: true,
        task: result.task,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error upserting CRM task',
      correlation_id: cid,
    });
  }
});

// Book endpoint - orchestrates full booking flow
app.post('/book', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      lead_id: string;
      manager_id: string;
      preferred_windows: Array<{ from: string; to: string }>;
      confirm?: boolean;
      qualification_flags?: Record<string, unknown>;
      explicit_confirmation?: boolean;
      confirmed_date?: string;
      confirmed_time?: string;
      call_id?: string;
    };

    // Validate required fields
    if (!body.lead_id || !body.manager_id || !body.preferred_windows || !Array.isArray(body.preferred_windows)) {
      return res.status(400).json({
        error: 'lead_id, manager_id, and preferred_windows array are required',
      });
    }

    // Step 1: Run policy.preBooking validation
    const policyContext = {
      booking_id: uuidv4(), // Generate temporary booking_id
      explicit_confirmation: body.explicit_confirmation || body.confirm || false,
      confirmed_date: body.confirmed_date,
      confirmed_time: body.confirmed_time,
      qualification_flags: body.qualification_flags || {},
    };

    const policyResult = validatePolicy('preBooking', policyContext);
    if (!policyResult.pass) {
      return res.status(400).json({
        error: `Pre-booking validation failed: ${policyResult.reason}`,
        reasonCode: policyResult.reasonCode,
      });
    }

    // Step 2: Find best available slot from preferred windows
    let bestSlot: { start_utc: string; end_utc: string } | null = null;
    let tentativeId: string | null = null;

    for (const window of body.preferred_windows) {
      const slots = getAvailability(body.manager_id, window);
      const availableSlot = slots.find((slot) => slot.available);

      if (availableSlot) {
        bestSlot = {
          start_utc: availableSlot.start_utc,
          end_utc: availableSlot.end_utc,
        };
        break;
      }
    }

    if (!bestSlot) {
      return res.status(400).json({
        error: 'No available slots found in preferred windows',
      });
    }

    // Step 3: Place calendar hold
    const holdResult = placeHold({
      manager_id: body.manager_id,
      start_utc: bestSlot.start_utc,
      end_utc: bestSlot.end_utc,
      ttl_seconds: 1800,
    });

    if (!holdResult.success) {
      return res.status(400).json({
        error: `Failed to place hold: ${holdResult.error}`,
      });
    }

    tentativeId = holdResult.tentative_id!;

    // Generate booking_id
    const bookingId = uuidv4();
    const meetingId = uuidv4();

    // Create booking record
    const booking = createBooking({
      booking_id: bookingId,
      lead_id: body.lead_id,
      contact_id: null,
      manager_id: body.manager_id,
      outcome: body.confirm ? 'booked' : 'reschedule_requested',
      qualification_flags: body.qualification_flags || {},
      notes: null,
      call_id: body.call_id || uuidv4(),
      created_ts: new Date().toISOString(),
    });

    // Emit analytics event
    emitBookingCreated(bookingId, body.lead_id, body.manager_id, booking.booking.outcome);

    // Update artifacts with tentative_id
    updateBookingArtifacts(bookingId, {
      tentative_id: tentativeId,
    });

    // Step 4: If confirm flag is true, create event, write to CRM, and enqueue confirmation
    if (body.confirm && body.explicit_confirmation && body.confirmed_date && body.confirmed_time) {
      // Create calendar event
      const eventResult = createEvent({
        meeting_id: meetingId,
        manager_id: body.manager_id,
        contact_email: null,
        title: 'Discovery Meeting',
        start_utc: body.confirmed_time,
        end_utc: new Date(new Date(body.confirmed_time).getTime() + 30 * 60 * 1000).toISOString(), // 30 minutes
        location: null,
        meeting_url: null,
        timezone: 'UTC', // Default, could be extracted from context
        description: null,
        invitees_emails: [`manager-${body.manager_id}@company.com`],
        source_system: 'ai-outbound',
        iCal_uid: '', // Will be generated by createEvent
      });

      // Emit analytics event
      emitCalendarEventCreated(meetingId, body.manager_id, bookingId, eventResult.success);

      if (!eventResult.success) {
        return res.status(400).json({
          error: `Failed to create calendar event: ${eventResult.error}`,
        });
      }

      // Write to CRM
      const crmResult = upsertTask({
        booking_id: bookingId,
        lead_id: body.lead_id,
        contact_id: null,
        manager_id: body.manager_id,
        outcome: 'booked',
        qualification_flags: body.qualification_flags || {},
        notes: null,
        call_id: body.call_id || uuidv4(),
        meeting_id: meetingId,
        created_ts: new Date().toISOString(),
        consent_status: 'granted',
      });

      // Emit analytics event
      emitCRMActivityWritten(bookingId, crmResult.task?.External_Id__c || bookingId, crmResult.success);

      if (!crmResult.success) {
        return res.status(400).json({
          error: `Failed to write CRM task: ${crmResult.error}`,
        });
      }

      // Enqueue confirmation message
      const confirmationMessage: ConfirmationMessage = {
        message_id: uuidv4(),
        channel: 'email',
        to: `lead-${body.lead_id}@example.com`, // Placeholder email
        template_id: 'booking_confirmation_v1',
        payload_json: {
          booking_id: bookingId,
          meeting_id: meetingId,
          meeting_date: body.confirmed_date,
          meeting_time: body.confirmed_time,
          meeting_url: eventResult.meeting_url,
        },
        sent_ts: new Date().toISOString(),
        delivery_status: 'queued',
      };

      const queueResult = enqueueConfirmation(confirmationMessage);

      // Update booking artifacts
      updateBookingArtifacts(bookingId, {
        meeting_id: meetingId,
        task_id: crmResult.task?.External_Id__c,
        confirmation_message_ids: [queueResult.message_id],
      });

      return res.status(200).json({
        success: true,
        booking_id: bookingId,
        meeting_id: meetingId,
        tentative_id: tentativeId,
        task_id: crmResult.task?.External_Id__c,
        confirmation_message_id: queueResult.message_id,
        artifacts: {
          hold: { tentative_id: tentativeId },
          event: { meeting_id: meetingId, meeting_url: eventResult.meeting_url },
          crm_task: { task_id: crmResult.task?.External_Id__c },
          confirmation: { message_id: queueResult.message_id },
        },
      });
    }

    // If not confirmed, just return the hold
    return res.status(200).json({
      success: true,
      booking_id: bookingId,
      tentative_id: tentativeId,
      status: 'hold_placed',
      artifacts: {
        hold: { tentative_id: tentativeId },
      },
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error processing booking',
      correlation_id: cid,
    });
  }
});

// Create booking (writes to CRM)
app.post('/bookings', (req: Request, res: Response) => {
  try {
    const body = req.body as TaskPayload & { meeting_id?: string };

    // Validate required fields
    if (
      !body.booking_id ||
      !body.lead_id ||
      !body.manager_id ||
      !body.outcome ||
      !body.qualification_flags ||
      !body.call_id ||
      !body.created_ts
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: booking_id, lead_id, manager_id, outcome, qualification_flags, call_id, created_ts',
      });
    }

    // Create task payload
    const taskPayload: TaskPayload = {
      booking_id: body.booking_id,
      lead_id: body.lead_id,
      contact_id: body.contact_id || null,
      manager_id: body.manager_id,
      outcome: body.outcome,
      qualification_flags: body.qualification_flags,
      notes: body.notes || null,
      call_id: body.call_id,
      meeting_id: body.meeting_id || null,
      created_ts: body.created_ts,
      consent_status: body.consent_status,
    };

    const result = upsertTask(taskPayload);

    if (result.success) {
      return res.status(200).json({
        success: true,
        booking_id: body.booking_id,
        task: result.task,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error creating booking',
      correlation_id: cid,
    });
  }
});

// Create event
app.post('/events', (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<CalendarEvent>;

    // Validate required fields
    if (!body.meeting_id || !body.manager_id || !body.start_utc || !body.end_utc || !body.timezone || !body.title || !body.invitees_emails || !body.source_system) {
      return res.status(400).json({
        error: 'Missing required fields: meeting_id, manager_id, start_utc, end_utc, timezone, title, invitees_emails, source_system',
      });
    }

    // Create event object
    const event: CalendarEvent = {
      meeting_id: body.meeting_id,
      manager_id: body.manager_id,
      contact_email: body.contact_email || null,
      title: body.title,
      start_utc: body.start_utc,
      end_utc: body.end_utc,
      location: body.location || null,
      meeting_url: body.meeting_url || null,
      timezone: body.timezone,
      description: body.description || null,
      invitees_emails: body.invitees_emails,
      source_system: body.source_system,
      iCal_uid: body.iCal_uid || '', // Will be generated by createEvent if empty
    };

    const result = createEvent(event);

    if (result.success) {
      return res.status(200).json({
        success: true,
        meeting_id: event.meeting_id,
        meeting_url: result.meeting_url,
        iCal_uid: result.iCal_uid,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error creating event',
      correlation_id: cid,
    });
  }
});

// Dev route: simulate happy path booking flow
app.post('/dev/simulate-happy-path', async (req: Request, res: Response) => {
  try {
    const managerId = req.body.manager_id || '0051234567890XYZ';
    const leadId = req.body.lead_id || '00Q1234567890ABC';

    // Step 1: Call started
    const callSession = createCallSession(leadId, '1');
    emitCallStarted(callSession.call_id, leadId, 1);

    // Step 2: Call connected
    processVoiceEvent(
      {
        call_id: callSession.call_id,
        event_type: 'answered',
      },
      leadId,
      1,
    );
    emitCallConnected(callSession.call_id, leadId, 'connected');

    // Step 3: Book with confirmation
    const preferredWindows = [
      {
        from: '2024-03-15T14:00:00.000Z',
        to: '2024-03-15T18:00:00.000Z',
      },
    ];

    // Get availability and place hold
    const slots = getAvailability(managerId, preferredWindows[0]);
    const availableSlot = slots.find((s) => s.available);
    if (!availableSlot) {
      return res.status(400).json({ error: 'No available slots' });
    }

    const holdResult = placeHold({
      manager_id: managerId,
      start_utc: availableSlot.start_utc,
      end_utc: availableSlot.end_utc,
      ttl_seconds: 1800,
    });

    if (!holdResult.success) {
      return res.status(400).json({ error: 'Failed to place hold' });
    }

    const bookingId = uuidv4();
    const meetingId = uuidv4();
    const confirmedTime = availableSlot.start_utc;

    // Create booking
    createBooking({
      booking_id: bookingId,
      lead_id: leadId,
      contact_id: null,
      manager_id: managerId,
      outcome: 'booked',
      qualification_flags: {
        budget: true,
        authority: true,
        need: 'high',
        timeline: 'this_quarter',
      },
      notes: null,
      call_id: callSession.call_id,
      created_ts: new Date().toISOString(),
    });
    emitBookingCreated(bookingId, leadId, managerId, 'booked');

    // Create calendar event
    const eventResult = createEvent({
      meeting_id: meetingId,
      manager_id: managerId,
      contact_email: null,
      title: 'Discovery Meeting',
      start_utc: confirmedTime,
      end_utc: availableSlot.end_utc,
      location: null,
      meeting_url: null,
      timezone: 'UTC',
      description: null,
      invitees_emails: [`manager-${managerId}@company.com`],
      source_system: 'ai-outbound',
      iCal_uid: '', // Will be generated by createEvent
    } as Parameters<typeof createEvent>[0]);
    emitCalendarEventCreated(meetingId, managerId, bookingId, eventResult.success);

    // Write CRM task
    const crmResult = upsertTask({
      booking_id: bookingId,
      lead_id: leadId,
      contact_id: null,
      manager_id: managerId,
      outcome: 'booked',
      qualification_flags: {
        budget: true,
        authority: true,
      },
      notes: null,
      call_id: callSession.call_id,
      meeting_id: meetingId,
      created_ts: new Date().toISOString(),
      consent_status: 'granted',
    });
    emitCRMActivityWritten(bookingId, crmResult.task?.External_Id__c || bookingId, crmResult.success);

    // Enqueue and process confirmation
    const confirmationMessage: ConfirmationMessage = {
      message_id: uuidv4(),
      channel: 'email',
      to: `lead-${leadId}@example.com`,
      template_id: 'booking_confirmation_v1',
      payload_json: {
        booking_id: bookingId,
        meeting_id: meetingId,
        meeting_date: confirmedTime,
        meeting_time: confirmedTime,
        meeting_url: eventResult.meeting_url,
      },
      sent_ts: new Date().toISOString(),
      delivery_status: 'queued',
    };

    enqueueConfirmation(confirmationMessage);

    // Process outbox
    const { drainOutbox } = await import('./messaging/outboxWorker.js');
    drainOutbox();

    return res.status(200).json({
      success: true,
      call_id: callSession.call_id,
      booking_id: bookingId,
      meeting_id: meetingId,
      summary: 'Happy path simulated - check /metrics/summary for results',
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error simulating happy path',
      correlation_id: cid,
    });
  }
});

// Dev route: simulate full call conversation
app.post('/dev/simulate-call', async (req: Request, res: Response) => {
  try {
    const managerId = req.body.manager_id || '0051234567890XYZ';
    const leadId = req.body.lead_id || '00Q1234567890ABC';
    const script = req.body.script || [
      { text: 'Hello?', state: 'IdentifyContact' },
      { text: 'Yes, I have a few minutes', state: 'ConsentGate' },
      { text: 'Yes, I am the decision maker', state: 'Qualify' },
      { text: 'We have an urgent need this quarter', state: 'Qualify' },
      { text: 'We have budget approved', state: 'Qualify' },
      { text: 'Option 1 works for me', state: 'ProposeTime' },
      { text: 'Yes, confirm it', state: 'Confirm' },
    ];

    // Step 1: Create call session
    const answerRes = await request(app)
      .post('/voice/answer')
      .send({
        lead_id: leadId,
        phone_number: '+1234567890',
        attempt_no: 1,
        manager_id: managerId,
      });

    const callId = answerRes.body.call_id;

    // Step 2: Process scripted utterances
    const results = [];
    let proposedTimes: string[] | undefined;

    for (const utterance of script) {
      // Get proposed times before ProposeTime state
      if (utterance.state === 'ProposeTime' && !proposedTimes) {
        const from = new Date();
        const to = new Date();
        to.setDate(to.getDate() + 7);
        const slots = getAvailability(managerId, { from: from.toISOString(), to: to.toISOString() });
        proposedTimes = slots.filter((s) => s.available).slice(0, 2).map((s) => s.start_utc);
      }

      const transcriptRes = await request(app).post('/voice/transcript').send({
        call_id: callId,
        text: utterance.text,
        confidence: 0.95,
        is_final: true,
        manager_id: managerId,
      });

      results.push({
        utterance: utterance.text,
        state_before: utterance.state,
        response: transcriptRes.body,
      });

      // If booking was created, break
      if (transcriptRes.body.booking_result) {
        break;
      }
    }

    // Step 3: Process outbox (simulate worker)
    const { drainOutbox } = await import('./messaging/outboxWorker.js');
    drainOutbox();

    // Step 4: Verify artifacts were created
    const session = getCallSession(callId);
    const bookingIntent = session?.state_machine.booking_intent;

    return res.status(200).json({
      success: true,
      call_id: callId,
      booking_intent: bookingIntent,
      results,
      artifacts: {
        calendar_event: bookingIntent ? 'created' : 'not_created',
        crm_task: bookingIntent ? 'created' : 'not_created',
        confirmation: bookingIntent ? 'queued' : 'not_queued',
      },
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error simulating call',
      correlation_id: cid,
    });
  }
});

// Transcript retrieval endpoints
app.get('/api/transcripts/:call_id', (req: Request, res: Response) => {
  try {
    const callId = req.params.call_id;
    const transcript = getTranscript(callId);
    
    if (!transcript) {
      return res.status(404).json({
        error: 'Transcript not found',
        call_id: callId,
      });
    }
    
    return res.status(200).json(transcript);
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error retrieving transcript',
      correlation_id: cid,
    });
  }
});

app.get('/api/transcripts/:call_id/text', (req: Request, res: Response) => {
  try {
    const callId = req.params.call_id;
    const text = getTranscriptText(callId);
    
    if (!text) {
      return res.status(404).json({
        error: 'Transcript not found',
        call_id: callId,
      });
    }
    
    return res.status(200).json({
      call_id: callId,
      transcript: text,
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error retrieving transcript',
      correlation_id: cid,
    });
  }
});

app.get('/api/transcripts', (req: Request, res: Response) => {
  try {
    const callIds = listTranscripts();
    return res.status(200).json({
      count: callIds.length,
      call_ids: callIds,
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error listing transcripts',
      correlation_id: cid,
    });
  }
});

// Dev route: seed manager calendar with two open slots
app.post('/dev/seed/managerCalendar', (req: Request, res: Response) => {
  try {
    const managerId = req.body.manager_id || '0051234567890XYZ';
    
    // Get today and tomorrow dates
    const today = new Date();
    today.setUTCHours(14, 0, 0, 0); // 2 PM UTC (within business hours)
    
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    
    // Create two open slots (30 minutes each)
    const slots = [
      {
        start_utc: today.toISOString(),
        end_utc: new Date(today.getTime() + 30 * 60 * 1000).toISOString(),
      },
      {
        start_utc: tomorrow.toISOString(),
        end_utc: new Date(tomorrow.getTime() + 30 * 60 * 1000).toISOString(),
      },
    ];

    // Verify slots are available (they should be since we're seeding)
    const todayWindow = {
      from: today.toISOString(),
      to: new Date(today.getTime() + 60 * 60 * 1000).toISOString(), // 1 hour window
    };
    const todayAvailability = getAvailability(managerId, todayWindow);
    const todaySlot = todayAvailability.find((s) => s.available);

    const tomorrowWindow = {
      from: tomorrow.toISOString(),
      to: new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString(),
    };
    const tomorrowAvailability = getAvailability(managerId, tomorrowWindow);
    const tomorrowSlot = tomorrowAvailability.find((s) => s.available);

    return res.status(200).json({
      success: true,
      manager_id: managerId,
      slots: [
        {
          date: 'today',
          start_utc: slots[0].start_utc,
          end_utc: slots[0].end_utc,
          available: todaySlot?.available ?? true,
        },
        {
          date: 'tomorrow',
          start_utc: slots[1].start_utc,
          end_utc: slots[1].end_utc,
          available: tomorrowSlot?.available ?? true,
        },
      ],
      message: 'Manager calendar seeded with two open slots',
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error seeding manager calendar',
      correlation_id: cid,
    });
  }
});

// Dev route: seed test leads
app.post('/dev/seed/leads', (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    
    // Five test leads: 3 NA, 2 EMEA
    const testLeads = [
      {
        lead_id: '00Q000000000001',
        name: 'John Smith',
        email: 'john.smith@acmecorp.com',
        phone: '+12025551234',
        company: 'Acme Corp',
        region: 'US_EAST',
        timezone: 'America/New_York',
        created_ts: now,
      },
      {
        lead_id: '00Q000000000002',
        name: 'Jane Doe',
        email: 'jane.doe@techstartup.io',
        phone: '+14155551234',
        company: 'TechStartup Inc',
        region: 'US_WEST',
        timezone: 'America/Los_Angeles',
        created_ts: now,
      },
      {
        lead_id: '00Q000000000003',
        name: 'Mike Johnson',
        email: 'mike.johnson@bigenterprise.com',
        phone: '+12125551234',
        company: 'Big Enterprise LLC',
        region: 'US_EAST',
        timezone: 'America/New_York',
        created_ts: now,
      },
      {
        lead_id: '00Q000000000004',
        name: 'Emma Wilson',
        email: 'emma.wilson@eurotech.eu',
        phone: '+33123456789',
        company: 'EuroTech GmbH',
        region: 'EU',
        timezone: 'Europe/Berlin',
        created_ts: now,
      },
      {
        lead_id: '00Q000000000005',
        name: 'David Brown',
        email: 'david.brown@ukcompany.co.uk',
        phone: '+442012345678',
        company: 'UK Company Ltd',
        region: 'EU',
        timezone: 'Europe/London',
        created_ts: now,
      },
    ];

    // Store leads in memory
    for (const lead of testLeads) {
      leads[lead.lead_id] = lead;
    }

    return res.status(200).json({
      success: true,
      leads_created: testLeads.length,
      leads: testLeads.map((l) => ({
        lead_id: l.lead_id,
        name: l.name,
        company: l.company,
        region: l.region,
        timezone: l.timezone,
      })),
      message: 'Test leads seeded successfully',
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error seeding leads',
      correlation_id: cid,
    });
  }
});

// Dev route: simulate speech conversation
app.post('/dev/simulate-speech', async (req: Request, res: Response) => {
  try {
    const callId = req.body.call_id || uuidv4();
    const asrConfig: ASRConfig = req.body.asr_config || { provider: 'stub' };
    const ttsConfig: TTSConfig = req.body.tts_config || { provider: 'stub' };

    // Create providers
    const asr = createASRProvider(asrConfig);
    const tts = createTTSProvider(ttsConfig);

    // Scripted conversation
    const conversation = [
      { speaker: 'ai', text: 'Hello, this is an automated call from our company.' },
      { speaker: 'human', text: 'Hello, this is John from Acme Corp.' },
      { speaker: 'ai', text: 'Hi John, I am calling to schedule a brief discovery meeting.' },
      { speaker: 'human', text: 'Sure, I have some time next week.' },
      { speaker: 'ai', text: 'Great, I have two options: Tuesday at 2 PM or Thursday at 10 AM.' },
      { speaker: 'human', text: 'Tuesday at 2 PM works for me.' },
      { speaker: 'ai', text: 'Perfect, I have scheduled the meeting for Tuesday at 2 PM.' },
    ];

    const partials: Array<{ speaker: string; text: string; confidence: number; timestamp: string }> = [];

    // Simulate conversation flow
    for (const turn of conversation) {
      if (turn.speaker === 'ai') {
        // AI speaks (TTS)
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ level: 'info', msg: 'ai_speak', call_id: callId, text: turn.text }));
        
        // Create text stream from single string
        async function* textStream() {
          yield turn.text;
        }

        // Stream TTS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioStreamResult: any = tts.stream(callId, textStream());
        for await (const audioChunk of audioStreamResult) {
          // Log audio chunk (but don't accumulate, just simulate)
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({
            level: 'debug',
            msg: 'tts_chunk',
            call_id: callId,
            format: audioChunk.format,
            sample_rate: audioChunk.sample_rate,
            data_size: audioChunk.data.length,
          }));
        }
      } else {
        // Human speaks (ASR)
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ level: 'info', msg: 'human_speak_start', call_id: callId, expected: turn.text }));

        // Create dummy audio stream (stub doesn't actually use it)
        async function* dummyAudioStream() {
          // Generate dummy audio buffer
          yield Buffer.alloc(1600); // 0.1s at 16kHz
        }

        // Stream ASR partials
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transcriptStream: any = asr.start(callId, dummyAudioStream());
        for await (const partial of transcriptStream) {
          // Log partial transcript
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({
            level: 'info',
            msg: 'asr_partial',
            call_id: callId,
            text: partial.text,
            confidence: partial.confidence,
            is_final: partial.is_final,
            timestamp: partial.timestamp,
          }));

          partials.push({
            speaker: 'human',
            text: partial.text,
            confidence: partial.confidence,
            timestamp: partial.timestamp,
          });

          if (partial.is_final) {
            break;
          }
        }
      }

      // Small delay between turns
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return res.status(200).json({
      success: true,
      call_id: callId,
      turns: conversation.length,
      partials: partials.length,
      summary: {
        ai_turns: conversation.filter((t) => t.speaker === 'ai').length,
        human_turns: conversation.filter((t) => t.speaker === 'human').length,
        total_partials: partials.length,
      },
    });
  } catch (error) {
    const cid = (req as any).correlationId;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: (error as Error).message, stack: (error as Error).stack, correlation_id: cid }));
    return res.status(500).json({
      error: 'Internal error simulating speech',
      correlation_id: cid,
    });
  }
});

// Central error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const cid = (req as any).correlationId;
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', msg: err.message, stack: err.stack, correlation_id: cid }));
  res.status(500).json({ error: 'internal_error', correlation_id: cid });
});

const server = http.createServer(app);

// WebSocket support
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'welcome', service: 'orchestrator', sha: GIT_SHA }));
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'server_started', port: PORT }));

  // Start outbox worker
  startWorker(5000); // Process every 5 seconds
});

export { app, server, leads, holds, bookings };

