/**
 * Conversation handler for managing multi-turn conversations
 */

import { getEnvConfig } from '../config/env.js';

export interface ConversationState {
  call_sid: string;
  step: 'greeting' | 'recording_consent' | 'consent' | 'interest' | 'qualify' | 'schedule' | 'confirm' | 'opt_out' | 'end';
  recording_consent: 'granted' | 'denied' | 'pending';
  interest_level: 'interested' | 'maybe' | 'not_interested' | 'unknown';
  questions_asked: string[];
  responses_given: string[];
  name?: string;
  company?: string;
  time_preference?: string;
}

// In-memory conversation store (keyed by call_sid)
const conversations = new Map<string, ConversationState>();

/**
 * Get or create conversation state
 */
export function getConversationState(callSid: string): ConversationState {
  // Normalize call_sid (handle 'unknown' case)
  const normalizedCallSid = callSid || 'unknown';
  
  if (!conversations.has(normalizedCallSid)) {
    conversations.set(normalizedCallSid, {
      call_sid: normalizedCallSid,
      step: 'greeting',
      recording_consent: 'pending',
      interest_level: 'unknown',
      questions_asked: [],
      responses_given: [],
    });
  }
  return conversations.get(normalizedCallSid)!;
}

/**
 * Update conversation state
 */
export function updateConversationState(callSid: string, updates: Partial<ConversationState>): ConversationState {
  const state = getConversationState(callSid);
  Object.assign(state, updates);
  conversations.set(callSid, state);
  return state;
}

/**
 * Parse user response to understand intent
 */
export function parseUserIntent(speechResult: string): {
  intent: 'yes' | 'no' | 'maybe' | 'question' | 'opt_out' | 'interested' | 'not_interested' | 'unknown';
  keywords: string[];
} {
  if (!speechResult) {
    return { intent: 'unknown', keywords: [] };
  }

  const lower = speechResult.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Opt-out keywords
  const optOutKeywords = ['stop', 'remove', 'opt out', 'do not call', "don't call", 'unsubscribe', 'remove me'];
  for (const keyword of optOutKeywords) {
    if (lower.includes(keyword)) {
      return { intent: 'opt_out', keywords: [keyword] };
    }
  }

  // Yes/positive responses
  const yesKeywords = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'interested', 'sounds good', 'that works', 'absolutely'];
  for (const keyword of yesKeywords) {
    if (lower.includes(keyword)) {
      return { intent: 'yes', keywords: [keyword] };
    }
  }

  // No/negative responses
  const noKeywords = ['no', 'nope', 'nah', "don't", 'not interested', 'not right now', 'maybe later'];
  for (const keyword of noKeywords) {
    if (lower.includes(keyword)) {
      if (lower.includes('maybe')) {
        return { intent: 'maybe', keywords: [keyword] };
      }
      return { intent: 'no', keywords: [keyword] };
    }
  }

  // Interest indicators
  if (lower.includes('interested') || lower.includes('like to') || lower.includes('would like')) {
    return { intent: 'interested', keywords: ['interested'] };
  }

  // Questions
  if (lower.includes('what') || lower.includes('how') || lower.includes('why') || lower.includes('when') || lower.includes('where') || lower.includes('who') || lower.endsWith('?')) {
    return { intent: 'question', keywords: ['question'] };
  }

  return { intent: 'unknown', keywords: [] };
}

/**
 * Extract name from speech
 */
export function extractName(speechResult: string): string | undefined {
  const patterns = [
    /(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:this is|speaking with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = speechResult.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Extract company from speech
 */
export function extractCompany(speechResult: string): string | undefined {
  const patterns = [
    /(?:from|at|with)\s+([A-Z][A-Za-z\s&]+)/,
    /company\s+(?:is|called)\s+([A-Z][A-Za-z\s&]+)/i,
  ];

  for (const pattern of patterns) {
    const match = speechResult.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Generate conversational response based on state and user input
 */
export function generateConversationalResponse(
  state: ConversationState,
  userInput?: string,
): { message: string; nextStep: ConversationState['step']; shouldEnd: boolean } {
  const config = getEnvConfig();
  const intent = userInput ? parseUserIntent(userInput) : null;

  switch (state.step) {
    case 'greeting':
      // If user responded to greeting, process their response
      if (userInput && intent) {
        if (intent.intent === 'yes') {
          // User said yes to "is this a good time"
          updateConversationState(state.call_sid, { step: 'recording_consent' });
          return {
            message: 'Great! Thank you. For quality assurance, may I record this call? You can say yes or no.',
            nextStep: 'recording_consent',
            shouldEnd: false,
          };
        } else if (intent.intent === 'no') {
          // User said no to "is this a good time"
          updateConversationState(state.call_sid, { step: 'end' });
          return {
            message: 'I understand. Perhaps another time would work better. Thank you for your time. Goodbye.',
            nextStep: 'end',
            shouldEnd: true,
          };
        } else {
          // Unclear response, ask again
          return {
            message: 'I just want to make sure this is a good time for a quick conversation. Is now okay?',
            nextStep: 'greeting',
            shouldEnd: false,
          };
        }
      }
      // Initial greeting (no user input yet)
      return {
        message: `Hello! This is ${config.COMPANY_NAME} calling. Is this a good time to talk?`,
        nextStep: 'greeting',
        shouldEnd: false,
      };

    case 'recording_consent':
      if (intent?.intent === 'yes') {
        updateConversationState(state.call_sid, {
          recording_consent: 'granted',
          step: 'interest',
        });
        return {
          message: 'Perfect! Thank you. ' +
            `We'd like to invite you to a brief discovery meeting where we can discuss how ${config.COMPANY_NAME} can help address your needs. ` +
            'This would be a 30-minute conversation at a time that works for you. Would you be interested in scheduling this meeting?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'no') {
        updateConversationState(state.call_sid, {
          recording_consent: 'denied',
          step: 'interest',
        });
        return {
          message: 'I understand. No problem. ' +
            `We'd like to invite you to a brief discovery meeting where we can discuss how ${config.COMPANY_NAME} can help address your needs. ` +
            'This would be a 30-minute conversation at a time that works for you. Would you be interested in scheduling this meeting?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'For quality assurance, may I record this call? You can say yes or no.',
          nextStep: 'recording_consent',
          shouldEnd: false,
        };
      }

    case 'consent':
      // Legacy step - redirect to recording_consent
      if (intent?.intent === 'yes') {
        updateConversationState(state.call_sid, {
          recording_consent: 'granted',
          step: 'interest',
        });
        return {
          message: 'Perfect! Thank you. ' +
            `We'd like to invite you to a brief discovery meeting where we can discuss how ${config.COMPANY_NAME} can help address your needs. ` +
            'This would be a 30-minute conversation at a time that works for you. Would you be interested in scheduling this meeting?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'no') {
        updateConversationState(state.call_sid, {
          recording_consent: 'denied',
          step: 'interest',
        });
        return {
          message: 'I understand. No problem. ' +
            `We'd like to invite you to a brief discovery meeting where we can discuss how ${config.COMPANY_NAME} can help address your needs. ` +
            'This would be a 30-minute conversation at a time that works for you. Would you be interested in scheduling this meeting?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'For quality assurance, may I record this call? You can say yes or no.',
          nextStep: 'recording_consent',
          shouldEnd: false,
        };
      }

    case 'interest':
      if (userInput) {
        const consent = parseUserIntent(userInput);
        if (consent.intent === 'yes') {
          updateConversationState(state.call_sid, { recording_consent: 'granted' });
        } else {
          updateConversationState(state.call_sid, { recording_consent: 'denied' });
        }
      }

      const name = userInput ? extractName(userInput) : undefined;
      const company = userInput ? extractCompany(userInput) : undefined;
      
      if (name) {
        updateConversationState(state.call_sid, { name });
      }
      if (company) {
        updateConversationState(state.call_sid, { company });
      }

      const greetingName = state.name ? `, ${state.name}` : '';
      return {
        message: `Thank you${greetingName}. ${config.COMPANY_NAME} helps businesses like yours solve important challenges. ` +
          `We'd like to offer you a brief, 30-minute discovery meeting where we can discuss how we might help. ` +
          `Would you be interested in learning more?`,
        nextStep: 'qualify',
        shouldEnd: false,
      };

    case 'qualify':
      if (!userInput) {
        return {
          message: 'Would you be interested in a brief discovery meeting?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      }

      if (intent?.intent === 'interested' || intent?.intent === 'yes') {
        updateConversationState(state.call_sid, {
          interest_level: 'interested',
          step: 'schedule',
        });
        return {
          message: 'Excellent! When would be a good time for you? I can offer times today or tomorrow. ' +
            'For example, you could say "tomorrow at 2pm" or "today afternoon".',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'maybe') {
        updateConversationState(state.call_sid, { interest_level: 'maybe' });
        return {
          message: 'I understand. Is there a better time we could reach out? Or would you like me to send you some information via email?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'not_interested' || intent?.intent === 'no') {
        updateConversationState(state.call_sid, {
          interest_level: 'not_interested',
          step: 'end',
        });
        return {
          message: 'I completely understand. Thank you for your time. If you change your mind, feel free to reach out. Have a great day!',
          nextStep: 'end',
          shouldEnd: true,
        };
      } else if (intent?.intent === 'question') {
        return {
          message: 'That\'s a great question. Let me send you some information about what we do. ' +
            'Would you be interested in a brief call to discuss further?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'I\'d love to tell you more about how we can help. Would a 30-minute discovery meeting work for you?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      }

    case 'schedule':
      if (!userInput) {
        return {
          message: 'When would be a good time for you? I can offer times today or tomorrow.',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      }

      // Extract time preference
      const timeMatch = userInput.match(/(today|tomorrow|morning|afternoon|evening|2pm|3pm|4pm|10am|11am)/i);
      if (timeMatch) {
        updateConversationState(state.call_sid, {
          time_preference: timeMatch[0],
          step: 'confirm',
        });
        return {
          message: `Perfect! I've noted ${timeMatch[0]} as your preferred time. ` +
            `I'll send you a calendar invitation with the details. Does that work for you?`,
          nextStep: 'confirm',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'yes') {
        // User said yes but didn't specify time
        return {
          message: 'Great! What time would work best for you? For example, tomorrow at 2pm or today afternoon?',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'I can offer times today or tomorrow. What works best for your schedule?',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      }

    case 'confirm':
      if (intent?.intent === 'yes') {
        updateConversationState(state.call_sid, { step: 'end' });
        return {
          message: `Wonderful! I'll send you a calendar invitation right away. ` +
            `Thank you so much for your time, ${state.name || 'and have a great day'}!`,
          nextStep: 'end',
          shouldEnd: true,
        };
      } else if (intent?.intent === 'no') {
        updateConversationState(state.call_sid, { step: 'schedule' });
        return {
          message: 'No problem. Would a different time work better?',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'Does that time work for you?',
          nextStep: 'confirm',
          shouldEnd: false,
        };
      }

    case 'opt_out':
      updateConversationState(state.call_sid, { step: 'end' });
      return {
        message: `I've noted your request. You will not receive further automated calls from ${config.COMPANY_NAME}. ` +
          'Thank you for your time. Goodbye.',
        nextStep: 'end',
        shouldEnd: true,
      };

    case 'end':
      return {
        message: 'Thank you. Goodbye.',
        nextStep: 'end',
        shouldEnd: true,
      };

    default:
      return {
        message: 'Thank you for your time. Goodbye.',
        nextStep: 'end',
        shouldEnd: true,
      };
  }
}

