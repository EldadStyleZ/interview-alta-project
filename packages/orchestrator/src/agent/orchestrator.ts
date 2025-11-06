/**
 * Call orchestration service
 * Manages the full conversation flow from answer to booking
 */

import { v4 as uuidv4 } from 'uuid';
import { initialState, nextState, type StateMachineState, type StateMachineInput, type ConversationContext, type BookingIntent } from './stateMachine.js';
import { createASRProvider, type ASRProvider, type ASRConfig, type PartialTranscript } from '../speech/asr.js';
import { createTTSProvider, type TTSProvider, type TTSConfig } from '../speech/tts.js';
import { getAvailability } from '../calendar/service.js';
import { emitOptOut } from '../analytics/bus.js';
import type { AudioStream } from '../speech/tts.js';

/**
 * Call session state
 */
export interface CallSession {
  call_id: string;
  lead_id: string;
  manager_id?: string;
  state_machine: StateMachineState;
  asr_provider: ASRProvider;
  tts_provider: TTSProvider;
  audio_stream?: AudioStream;
  is_active: boolean;
  mandatory_lines_sent: Set<string>;
}

/**
 * Call session store (in-memory)
 */
const callSessions = new Map<string, CallSession>();

/**
 * Mandatory opener lines
 */
const MANDATORY_OPENER_LINES = {
  identification: "Hello, this is an automated call from our company. I'm calling to schedule a brief discovery meeting.",
  purpose: "I'm calling to schedule a brief discovery meeting with one of our senior account managers.",
  consent: "Do you have a few minutes to talk?",
};

/**
 * Extract intent from transcript text
 */
function extractIntent(text: string, state: string): StateMachineInput['intent'] {
  const lower = text.toLowerCase();

  // Opt-out keywords
  if (lower.includes('stop') || lower.includes('remove') || lower.includes('do not call') || lower.includes('dont call') || lower.includes('opt out') || lower.includes('unsubscribe')) {
    return 'opt_out';
  }

  // Consent keywords
  if ((lower.includes('yes') || lower.includes('sure') || lower.includes('ok') || lower.includes('okay')) && state === 'ConsentGate') {
    return 'consent';
  }

  // Transfer keywords
  if (lower.includes('transfer') || lower.includes('speak to') || lower.includes('human')) {
    return 'transfer';
  }

  // Confirmation keywords
  if ((lower.includes('yes') || lower.includes('confirm') || lower.includes('sounds good') || lower.includes('that works')) && state === 'Confirm') {
    return 'confirm';
  }

  // Time selection keywords
  if (state === 'ProposeTime') {
    if (lower.includes('first') || lower.includes('option 1') || lower.includes('one') || lower.match(/\b1\b/)) {
      return 'confirm';
    }
    if (lower.includes('second') || lower.includes('option 2') || lower.includes('two') || lower.match(/\b2\b/)) {
      return 'confirm';
    }
    if (lower.includes('yes') || lower.includes('sure') || lower.includes('that works') || lower.includes('sounds good')) {
      return 'confirm';
    }
    if (lower.match(/\d{1,2}:\d{2}/) || lower.match(/\d{1,2}\s*(am|pm)/i)) {
      return 'confirm';
    }
  }

  return undefined;
}

/**
 * Extract time from transcript
 */
function extractTimeFromTranscript(text: string, proposedTimes?: string[]): string | undefined {
  if (!proposedTimes || proposedTimes.length === 0) {
    return undefined;
  }

  const lower = text.toLowerCase();

  // Check for explicit option selection
  if (lower.includes('first') || lower.includes('option 1') || lower.includes('one') || lower.match(/\b1\b/)) {
    return proposedTimes[0];
  }
  if (lower.includes('second') || lower.includes('option 2') || lower.includes('two') || lower.match(/\b2\b/)) {
    return proposedTimes[1] || proposedTimes[0];
  }

  // Try to extract time patterns (simplified - in production would use NLP)
  // For now, just return the first proposed time if user confirms
  if (lower.includes('yes') || lower.includes('sure') || lower.includes('that works') || lower.includes('sounds good')) {
    return proposedTimes[0];
  }

  return undefined;
}

/**
 * Extract qualification slots from transcript
 */
function extractQualificationSlots(text: string): Partial<StateMachineInput['slots']> {
  const lower = text.toLowerCase();
  const slots: Partial<StateMachineInput['slots']> = {};

  // Authority detection
  if (lower.includes('decision') || lower.includes('authority') || lower.includes('decision maker') || lower.includes('i decide') || lower.includes('i make')) {
    slots.authority = true;
  }

  // Need detection
  if (lower.includes('urgent') || lower.includes('critical') || lower.includes('important') || lower.includes('need')) {
    slots.need = 'high';
  } else if (lower.includes('interested') || lower.includes('consider')) {
    slots.need = 'medium';
  }

  // Timing detection
  if (lower.includes('urgent') || lower.includes('immediately') || lower.includes('asap') || lower.includes('this month') || lower.includes('this quarter')) {
    slots.timing = 'this_quarter';
  } else if (lower.includes('next quarter') || lower.includes('q2') || lower.includes('q3') || lower.includes('q4')) {
    slots.timing = 'next_quarter';
  }

  // Budget detection
  if (lower.includes('budget') && (lower.includes('have') || lower.includes('approved'))) {
    slots.budget_indicator = 'present';
  }

  // Pain detection
  if (lower.includes('problem') || lower.includes('challenge') || lower.includes('issue') || lower.includes('struggling')) {
    slots.pain_stated = true;
  }

  return slots;
}

/**
 * Generate TTS text for current state
 */
async function generateStatePrompt(state: StateMachineState, managerId?: string, proposedTimes?: string[]): Promise<string> {
  switch (state.current) {
    case 'IdentifyContact':
      return MANDATORY_OPENER_LINES.identification + ' ' + MANDATORY_OPENER_LINES.purpose + ' ' + MANDATORY_OPENER_LINES.consent;

    case 'ConsentGate':
      if (!state.mandatory_lines.consent_to_proceed) {
        return "I'd like to schedule a brief discovery meeting. Do you have a few minutes to talk?";
      }
      if (state.context.recording_required && !state.mandatory_lines.recording_consent) {
        return "This call may be recorded for quality assurance. Do you consent to recording?";
      }
      return "Great! Let me ask you a few quick questions to understand your needs.";

    case 'Qualify':
      if (!state.mandatory_lines.consent_to_proceed) {
        return "Do you have a few minutes to talk?";
      }
      return "I'd like to understand your situation better. Are you the decision maker for this type of purchase?";

    case 'ProposeTime':
      if (!proposedTimes || proposedTimes.length < 2) {
        return "I don't have any available times right now. Let me check with our team and get back to you.";
      }
      // Format times for speaking
      const time1 = new Date(proposedTimes[0]).toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZone: 'UTC',
      });
      const time2 = new Date(proposedTimes[1]).toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZone: 'UTC',
      });
      return `I have two options available. Option 1: ${time1}. Option 2: ${time2}. Which works better for you?`;

    case 'Confirm':
      if (state.booking_intent) {
        const time = new Date(state.booking_intent.confirmed_time).toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          timeZone: 'UTC',
        });
        return `Perfect! I've scheduled your meeting for ${time}. You'll receive a confirmation email shortly with all the details. Is there anything else I can help you with?`;
      }
      return "Great! I've scheduled your meeting. You'll receive a confirmation email shortly.";

    case 'OptOut':
      return "I understand. I've removed you from our calling list. Have a great day.";

    case 'Transfer':
      return "I'll transfer you to a human agent now. Please hold.";

    case 'Voicemail':
      return "I'm calling to schedule a discovery meeting. Please call us back at your earliest convenience.";

    case 'End':
      return "Thank you for your time. Have a great day!";

    default:
      return "I'm here to help schedule a discovery meeting. How can I assist you?";
  }
}

/**
 * Create a new call session
 */
export function createCallSession(
  callId: string,
  leadId: string,
  managerId?: string,
  asrConfig: ASRConfig = { provider: 'stub' },
  ttsConfig: TTSConfig = { provider: 'stub' },
): CallSession {
  const context: ConversationContext = {
    call_id: callId,
    lead_id: leadId,
    recording_required: false, // Could be based on jurisdiction
  };

  const stateMachine = initialState(context);

  const session: CallSession = {
    call_id: callId,
    lead_id: leadId,
    manager_id: managerId,
    state_machine: stateMachine,
    asr_provider: createASRProvider(asrConfig),
    tts_provider: createTTSProvider(ttsConfig),
    is_active: true,
    mandatory_lines_sent: new Set(),
  };

  callSessions.set(callId, session);
  return session;
}

/**
 * Get call session
 */
export function getCallSession(callId: string): CallSession | undefined {
  return callSessions.get(callId);
}

/**
 * Process transcript and update state machine
 */
export function processTranscript(
  callId: string,
  transcript: PartialTranscript,
  proposedTimes?: string[],
): { state: StateMachineState; intent?: BookingIntent; should_speak: boolean; prompt?: string } {
  const session = callSessions.get(callId);
  if (!session || !session.is_active) {
    throw new Error(`Call session ${callId} not found or inactive`);
  }

  const text = transcript.text;
  const currentState = session.state_machine.current;
  const intent = extractIntent(text, currentState);
  const slots = extractQualificationSlots(text);
  const selectedTime = proposedTimes ? extractTimeFromTranscript(text, proposedTimes) : undefined;

  const input: StateMachineInput = {
    intent,
    text,
    slots,
    explicit_confirmation: intent === 'confirm' && selectedTime !== undefined,
    selected_time: selectedTime,
  };

  // Update state machine
  session.state_machine = nextState(session.state_machine, input);

  // Handle opt-out
  if (session.state_machine.current === 'OptOut') {
    session.is_active = false;
    emitOptOut(session.lead_id, callId);
  }

  // Generate prompt if state changed or mandatory line needed
  const shouldSpeak = session.state_machine.current !== currentState;

  return {
    state: session.state_machine,
    intent: session.state_machine.booking_intent,
    should_speak: shouldSpeak,
  };
}

/**
 * Get prompt for current state (async version)
 */
export async function getStatePrompt(state: StateMachineState, managerId?: string, proposedTimes?: string[]): Promise<string> {
  return generateStatePrompt(state, managerId, proposedTimes);
}

/**
 * Start ASR streaming for a call
 */
export async function startASRStreaming(callId: string, audioStream: AudioStream): Promise<void> {
  const session = callSessions.get(callId);
  if (!session) {
    throw new Error(`Call session ${callId} not found`);
  }

  // Start ASR streaming (in real implementation, this would process audio)
  // For now, we'll handle transcripts via processTranscript
  session.audio_stream = audioStream;
}

/**
 * Speak text using TTS
 */
export async function speakText(callId: string, text: string): Promise<void> {
  const session = callSessions.get(callId);
  if (!session) {
    throw new Error(`Call session ${callId} not found`);
  }

  // Create text stream
  async function* textStream() {
    yield text;
  }

  // Stream audio (in real implementation, this would send audio to CPaaS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audioStream: any = session.tts_provider.stream(callId, textStream());
  for await (const _chunk of audioStream) {
    // In real implementation, send audio chunks to CPaaS
    // For now, just consume the stream
  }
}

/**
 * Get proposed times from calendar availability
 */
export async function getProposedTimes(managerId: string, window: { from: string; to: string }): Promise<string[]> {
  const slots = getAvailability(managerId, window);
  const availableSlots = slots.filter((s) => s.available).slice(0, 2); // Get first 2 available slots
  return availableSlots.map((s) => s.start_utc);
}

/**
 * End call session
 */
export function endCallSession(callId: string): void {
  const session = callSessions.get(callId);
  if (session) {
    session.is_active = false;
  }
}

// Export for testing
export { callSessions };

