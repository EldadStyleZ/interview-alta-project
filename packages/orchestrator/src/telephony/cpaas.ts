import { v4 as uuidv4 } from 'uuid';
import { CallEventSchema, type CallEvent } from '../contracts/index.js';

// In-memory call store keyed by call_id
export const callStore: Map<string, CallEvent> = new Map();

export interface AnswerCallRequest {
  lead_id: string;
  phone_number: string;
  attempt_no?: number;
}

export interface AnswerCallResponse {
  call_id: string;
  session_id: string;
  instructions: {
    text: string;
    voice?: string;
  };
}

export interface VoiceEventRequest {
  call_id: string;
  event_type: 'answered' | 'no-answer' | 'busy' | 'failed' | 'voicemail' | 'completed';
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface VoiceEventResponse {
  success: boolean;
  call_id: string;
  event_id?: string;
  error?: string;
}

/**
 * Create a new call session
 */
export function createCallSession(leadId: string, attemptNo: number = 1): AnswerCallResponse {
  const callId = uuidv4();
  const sessionId = uuidv4();

  // Create initial CallEvent with status based on answer
  const initialEvent: CallEvent = {
    call_id: callId,
    lead_id: leadId,
    attempt_no: attemptNo,
    status: 'connected', // Will be updated by events
    start_ts: new Date().toISOString(),
    end_ts: null,
    recording_url: null,
    consent_status: 'not_asked',
    dnc_flag: false,
    asr_confidence: null,
  };

  // Store in callStore
  callStore.set(callId, initialEvent);

  return {
    call_id: callId,
    session_id: sessionId,
    instructions: {
      text: 'Hello, this is an automated call from our company. I am calling to schedule a brief discovery meeting. Do you have a few minutes to talk?',
      voice: 'default',
    },
  };
}

/**
 * Process voice event callback and persist CallEvent
 */
export function processVoiceEvent(
  event: VoiceEventRequest,
  leadId: string,
  attemptNo: number = 1,
): VoiceEventResponse {
  try {
    // Map event_type to CallEvent status
    const statusMap: Record<string, CallEvent['status']> = {
      answered: 'connected',
      'no-answer': 'no_answer',
      busy: 'busy',
      failed: 'failed',
      voicemail: 'voicemail',
      completed: 'connected',
    };

    const status = statusMap[event.event_type] || 'failed';

    // Get existing call or create new
    let callEvent: CallEvent;
    const existingCall = callStore.get(event.call_id);

    if (existingCall) {
      // Update existing call
      callEvent = {
        ...existingCall,
        status,
        end_ts: event.event_type === 'completed' || event.event_type === 'no-answer' 
          ? (event.timestamp || new Date().toISOString())
          : existingCall.end_ts,
      };
    } else {
      // Create new call event
      callEvent = {
        call_id: event.call_id,
        lead_id: leadId,
        attempt_no: attemptNo,
        status,
        start_ts: event.timestamp || new Date().toISOString(),
        end_ts: event.event_type === 'completed' || event.event_type === 'no-answer'
          ? (event.timestamp || new Date().toISOString())
          : null,
        recording_url: null,
        consent_status: 'not_asked',
        dnc_flag: false,
        asr_confidence: null,
      };
    }

    // Validate using contract schema
    const validationResult = CallEventSchema.safeParse(callEvent);
    if (!validationResult.success) {
      return {
        success: false,
        call_id: event.call_id,
        error: `Validation failed: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
      };
    }

    // Store validated event
    callStore.set(event.call_id, validationResult.data);

    return {
      success: true,
      call_id: event.call_id,
      event_id: uuidv4(),
    };
  } catch (error) {
    return {
      success: false,
      call_id: event.call_id,
      error: (error as Error).message,
    };
  }
}

/**
 * Get call by ID
 */
export function getCallById(callId: string): CallEvent | undefined {
  return callStore.get(callId);
}

