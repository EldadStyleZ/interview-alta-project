import twilio from 'twilio';
import { getEnvConfig } from '../config/env.js';
import {
  getConversationState,
  updateConversationState,
  generateConversationalResponse,
  parseUserIntent,
} from './conversationHandler.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

/**
 * Generate TwiML for outbound call flow with consent and demo
 */
export function generateOutboundTwiML(
  recordingConsent: 'granted' | 'denied' | 'pending' = 'pending',
  callSid?: string,
): string {
  const config = getEnvConfig();
  const response = new VoiceResponse();

  // Start with greeting
  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    `Hello! This is ${config.COMPANY_NAME} calling. Is this a good time to talk?`,
  );

  // Gather initial response
  const gather = response.gather({
    input: ['speech'],
    timeout: 5,
    speechTimeout: 'auto',
    action: `/twilio/voice/incoming?action=conversation${callSid ? `&call_sid=${callSid}` : ''}`,
    method: 'POST',
  });

  // Fallback if no response - more natural
  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    'Thanks for taking the call. Have a great day!',
  );
  response.hangup();

  return response.toString();
}

/**
 * Generate conversational TwiML based on conversation state
 */
export function generateConversationalTwiML(
  callSid: string,
  userInput?: string,
  recordingEnabled: boolean = false,
): string {
  try {
    const config = getEnvConfig();
    const response = new VoiceResponse();
    
    if (!callSid) {
      // Fallback if no call_sid
      response.say({
        voice: 'Polly.Salli',
        language: 'en-US',
      }, 'Hello! This is ' + config.COMPANY_NAME + ' calling. Is this a good time to talk?');
      const gather = response.gather({
        input: ['speech'],
        timeout: 5,
        speechTimeout: 'auto',
        action: '/twilio/voice/incoming?action=conversation',
        method: 'POST',
      });
      return response.toString();
    }
    
    const state = getConversationState(callSid);

  // Start recording if consent was granted
  if (recordingEnabled && state.recording_consent === 'granted') {
    response.record({
      recordingStatusCallback: `${config.PUBLIC_BASE_URL}/twilio/voice/recording-status`,
      recordingStatusCallbackMethod: 'POST',
      maxLength: 600, // 10 minutes max
      finishOnKey: '#',
    });
  }

  // Generate conversational response
  const conversation = generateConversationalResponse(state, userInput);

  // Update state
  updateConversationState(callSid, {
    step: conversation.nextStep,
    responses_given: userInput ? [...state.responses_given, userInput] : state.responses_given,
  });

  // Check for opt-out
  if (userInput && parseUserIntent(userInput).intent === 'opt_out') {
    updateConversationState(callSid, { step: 'opt_out' });
    const optOutResponse = generateConversationalResponse(
      { ...state, step: 'opt_out' },
      userInput,
    );
    response.say(
      {
        voice: 'Polly.Salli',
        language: 'en-US',
      },
      optOutResponse.message,
    );
    response.hangup();
    return response.toString();
  }

  // Speak the response
  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    conversation.message,
  );

  // If not ending, gather next input
  if (!conversation.shouldEnd && conversation.nextStep !== 'end') {
    const gather = response.gather({
      input: ['speech'],
      timeout: 5,
      speechTimeout: 'auto',
      action: `/twilio/voice/incoming?action=conversation&call_sid=${callSid}`,
      method: 'POST',
      finishOnKey: '#',
    });

    // Small prompt to encourage response - more natural and human-like
    const naturalPrompts = [
      "What do you think?",
      "How does that sound?",
      "Does that work for you?",
      "What's your take on that?",
    ];
    const prompt = naturalPrompts[Math.floor(Math.random() * naturalPrompts.length)];
    gather.say(
      {
        voice: 'Polly.Salli',
        language: 'en-US',
      },
      prompt,
    );

    // Handle timeout - move to next step or end - more natural
    if (conversation.nextStep === 'qualify' || conversation.nextStep === 'schedule') {
      response.say(
        {
          voice: 'Polly.Salli',
          language: 'en-US',
        },
        'I understand if now isn\'t a great time. No worries at all. Thanks for taking the call, and have a wonderful day!',
      );
    } else {
      response.say(
        {
          voice: 'Polly.Salli',
          language: 'en-US',
        },
        'Thanks so much for your time. Have a great day!',
      );
    }
    response.hangup();
  } else {
    // End conversation
    response.hangup();
  }

  return response.toString();
  } catch (error) {
    // Fallback error response
    const config = getEnvConfig();
    const response = new VoiceResponse();
    response.say({
      voice: 'Polly.Salli',
      language: 'en-US',
    }, `Hello! This is ${config.COMPANY_NAME} calling. Is this a good time to talk?`);
    const gather = response.gather({
      input: ['speech'],
      timeout: 5,
      speechTimeout: 'auto',
      action: '/twilio/voice/incoming?action=conversation',
      method: 'POST',
    });
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Error generating conversational TwiML',
      error: (error as Error).message,
      call_sid: callSid,
    }));
    return response.toString();
  }
}

/**
 * Generate TwiML for demo prompt (30-60 seconds) - kept for backward compatibility
 */
export function generateDemoPromptTwiML(recordingEnabled: boolean = false): string {
  const config = getEnvConfig();
  const response = new VoiceResponse();

  // Start recording if consent was granted
  if (recordingEnabled) {
    response.record({
      recordingStatusCallback: `${config.PUBLIC_BASE_URL}/twilio/voice/recording-status`,
      recordingStatusCallbackMethod: 'POST',
      maxLength: 300, // 5 minutes max
      finishOnKey: '#',
    });
  }

  // Demo prompt: discovery invitation
  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    `Thank you. We'd like to invite you to a brief discovery meeting where we can discuss how ${config.COMPANY_NAME} can help address your needs. ` +
      `This would be a 30-minute conversation at a time that works for you. ` +
      `Would you be interested in scheduling this meeting?`,
  );

  // Gather response for opt-out or interest
  const gather = response.gather({
    input: ['speech'],
    timeout: 5,
    speechTimeout: 'auto',
    action: '/twilio/voice/incoming?action=handle_response',
    method: 'POST',
    finishOnKey: '#',
  });

  gather.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    'I\'d love to hear your thoughts. If you\'re interested, just let me know. Or if you\'d prefer not to receive these calls, you can say "stop" or "remove me".',
  );

  // Handle timeout
  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    'Thank you for your time. Have a great day.',
  );

  response.hangup();

  return response.toString();
}

/**
 * Generate TwiML for opt-out confirmation
 */
export function generateOptOutTwiML(): string {
  const config = getEnvConfig();
  const response = new VoiceResponse();

  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    `I've noted your request. You will not receive further automated calls from ${config.COMPANY_NAME}. ` +
      'Is there anything else I can help with today?',
  );

  // Wait briefly for response, then end
  response.pause({ length: 2 });

  response.say(
    {
      voice: 'Polly.Salli',
      language: 'en-US',
    },
    'Thank you. Goodbye.',
  );

  response.hangup();

  return response.toString();
}

/**
 * Parse speech input for consent response
 */
export function parseConsentResponse(speechResult?: string): 'granted' | 'denied' {
  if (!speechResult) {
    return 'denied';
  }

  const lower = speechResult.toLowerCase().trim();
  const yesKeywords = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'agree', 'consent'];
  const noKeywords = ['no', 'nope', 'nah', 'decline', 'refuse', 'deny'];

  for (const keyword of yesKeywords) {
    if (lower.includes(keyword)) {
      return 'granted';
    }
  }

  for (const keyword of noKeywords) {
    if (lower.includes(keyword)) {
      return 'denied';
    }
  }

  // Default to denied if unclear
  return 'denied';
}

/**
 * Parse speech input for opt-out keywords
 */
export function parseOptOutRequest(speechResult?: string): boolean {
  if (!speechResult) {
    return false;
  }

  const lower = speechResult.toLowerCase().trim();
  const optOutKeywords = ['stop', 'remove me', 'remove', 'opt out', 'do not call', 'don\'t call', 'unsubscribe'];

  for (const keyword of optOutKeywords) {
    if (lower.includes(keyword)) {
      return true;
    }
  }

  return false;
}

