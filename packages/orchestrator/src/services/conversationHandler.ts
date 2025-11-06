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

  // Yes/positive responses - expanded for more natural recognition
  const yesKeywords = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'interested', 'sounds good', 'that works', 'absolutely', 'definitely', 'sounds great', 'i\'d like that', 'that would be great', 'let\'s do it'];
  for (const keyword of yesKeywords) {
    if (lower.includes(keyword)) {
      return { intent: 'yes', keywords: [keyword] };
    }
  }

  // No/negative responses - expanded for more natural recognition
  const noKeywords = ['no', 'nope', 'nah', "don't", 'not interested', 'not right now', 'maybe later', 'not really', 'probably not', 'i don\'t think so', 'not at this time'];
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
          message: 'Great! Thanks for taking the time. Before we continue, would it be okay if I record this call for quality purposes? You can say yes or no.',
          nextStep: 'recording_consent',
          shouldEnd: false,
        };
        } else if (intent.intent === 'no') {
          // User said no to "is this a good time"
          updateConversationState(state.call_sid, { step: 'end' });
          return {
            message: 'I totally understand. No worries at all. Thanks for taking the call. Have a great day!',
            nextStep: 'end',
            shouldEnd: true,
          };
        } else {
          // Unclear response, ask again - more natural
          return {
            message: 'I just want to make sure I\'m not catching you at a bad time. Is now okay for a quick chat?',
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
            `I'm calling from ${config.COMPANY_NAME}, and we help businesses like yours tackle some common challenges. ` +
            'I\'d love to offer you a quick 30-minute conversation where we can explore if there\'s a good fit. Would that be something you\'d be open to?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'no') {
        updateConversationState(state.call_sid, {
          recording_consent: 'denied',
          step: 'interest',
        });
        return {
          message: 'No problem at all. I completely understand. ' +
            `I'm calling from ${config.COMPANY_NAME}, and we work with businesses to solve some common challenges. ` +
            'Would you be open to a quick 30-minute conversation to see if there might be a good fit?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else {
          return {
            message: 'Would it be okay if I record this call for quality purposes? You can say yes or no.',
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
            `I'm calling from ${config.COMPANY_NAME}, and we help businesses like yours tackle some common challenges. ` +
            'I\'d love to offer you a quick 30-minute conversation where we can explore if there\'s a good fit. Would that be something you\'d be open to?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'no') {
        updateConversationState(state.call_sid, {
          recording_consent: 'denied',
          step: 'interest',
        });
        return {
          message: 'No problem at all. I completely understand. ' +
            `I'm calling from ${config.COMPANY_NAME}, and we work with businesses to solve some common challenges. ` +
            'Would you be open to a quick 30-minute conversation to see if there might be a good fit?',
          nextStep: 'interest',
          shouldEnd: false,
        };
      } else {
          return {
            message: 'Would it be okay if I record this call for quality purposes? You can say yes or no.',
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
        message: `Thanks${greetingName}. So ${config.COMPANY_NAME} works with companies to solve some pretty common challenges they face. ` +
          `I'd love to offer you a quick 30-minute chat where we can explore if there's a good fit. ` +
          `Would that be something you'd be interested in?`,
        nextStep: 'qualify',
        shouldEnd: false,
      };

    case 'qualify':
      if (!userInput) {
        return {
          message: 'Would you be open to a quick 30-minute conversation to see if there might be a good fit?',
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
          message: 'That\'s great! I\'m glad you\'re interested. When would work best for you? ' +
            'I can do today or tomorrow - just let me know what time works. For example, you could say "tomorrow at 2pm" or "today afternoon".',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'maybe') {
        updateConversationState(state.call_sid, { interest_level: 'maybe' });
        return {
          message: 'I totally get that. Would it help if I sent you some information first? Or maybe there\'s a better time to reach out?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'not_interested' || intent?.intent === 'no') {
        updateConversationState(state.call_sid, {
          interest_level: 'not_interested',
          step: 'end',
        });
        return {
          message: 'I completely understand. No worries at all. Thanks for taking the time to chat. If anything changes, feel free to reach out. Have a wonderful day!',
          nextStep: 'end',
          shouldEnd: true,
        };
      } else if (intent?.intent === 'question') {
        return {
          message: 'That\'s a really good question. I\'d be happy to send you some information that might help answer that. ' +
            'Would you be open to a quick call after you\'ve had a chance to look it over?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'I\'d love to share a bit more about what we do and see if it might be a good fit. ' +
            'Would a quick 30-minute conversation work for you?',
          nextStep: 'qualify',
          shouldEnd: false,
        };
      }

    case 'schedule':
      if (!userInput) {
        return {
          message: 'What time would work best for you? I can do today or tomorrow - whatever fits your schedule.',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      }

      // Extract time preference - expanded to handle more natural expressions
      const timeMatch = userInput.match(/(today|tomorrow|morning|afternoon|evening|2pm|3pm|4pm|10am|11am|later|next week|monday|tuesday|wednesday|thursday|friday)/i);
      if (timeMatch) {
        updateConversationState(state.call_sid, {
          time_preference: timeMatch[0],
          step: 'confirm',
        });
        return {
          message: `Perfect! So ${timeMatch[0]} works for you. ` +
            `I'll send over a calendar invite with all the details. Sound good?`,
          nextStep: 'confirm',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'yes') {
        // User said yes but didn't specify time
        return {
          message: 'Awesome! What time would work best? I can do today or tomorrow - just let me know what works for you.',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else if (intent?.intent === 'no') {
        // User declined the time - offer reschedule
        updateConversationState(state.call_sid, { step: 'schedule' });
        return {
          message: 'No problem! Would a different time work better? What would be convenient for you?',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'I can do today or tomorrow - whatever works best for you. What time would be good?',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      }

    case 'confirm':
      if (intent?.intent === 'yes') {
        updateConversationState(state.call_sid, { step: 'end' });
        const namePart = state.name ? `, ${state.name}` : '';
        return {
          message: `Perfect! I'll get that calendar invite sent over right away. ` +
            `Thanks so much for your time${namePart} - really appreciate it. Have a great day!`,
          nextStep: 'end',
          shouldEnd: true,
        };
      } else if (intent?.intent === 'no') {
        updateConversationState(state.call_sid, { step: 'schedule' });
        return {
          message: 'No worries at all. What time would work better for you?',
          nextStep: 'schedule',
          shouldEnd: false,
        };
      } else {
        return {
          message: 'Does that time work for you, or would you prefer something else?',
          nextStep: 'confirm',
          shouldEnd: false,
        };
      }

    case 'opt_out':
      updateConversationState(state.call_sid, { step: 'end' });
      return {
        message: `I've got that noted. You won't receive any more automated calls from ${config.COMPANY_NAME}. ` +
          'Thanks for letting me know, and have a great day.',
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

