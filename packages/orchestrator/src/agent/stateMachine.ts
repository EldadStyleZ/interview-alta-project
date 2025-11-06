/**
 * State machine for conversation agent
 */

export type State =
  | 'IdentifyContact'
  | 'ConsentGate'
  | 'Qualify'
  | 'ProposeTime'
  | 'Confirm'
  | 'OptOut'
  | 'Transfer'
  | 'Voicemail'
  | 'End';

export interface ConversationSlots {
  authority?: boolean;
  need?: 'high' | 'medium' | 'low';
  timing?: 'this_quarter' | 'next_quarter' | 'later';
  budget_indicator?: 'present' | 'unknown' | 'absent';
  confirmed_date?: string; // RFC 3339 UTC
  confirmed_time?: string; // RFC 3339 UTC
  pain_stated?: boolean;
}

export interface MandatoryLines {
  identification?: boolean;
  purpose?: boolean;
  consent_to_proceed?: boolean;
  recording_consent?: boolean;
}

export interface BookingIntent {
  booking_id: string;
  lead_id: string;
  confirmed_date: string; // RFC 3339 UTC
  confirmed_time: string; // RFC 3339 UTC
  qualification_flags: ConversationSlots;
  explicit_confirmation: boolean;
}

export interface ConversationContext {
  call_id: string;
  lead_id: string;
  contact_name?: string;
  company_name?: string;
  recording_required?: boolean;
  jurisdiction?: string;
}

export interface StateMachineInput {
  intent?: 'identify' | 'consent' | 'qualify' | 'propose' | 'confirm' | 'opt_out' | 'transfer' | 'voicemail' | 'disqualify';
  text?: string;
  slots?: Partial<ConversationSlots>;
  explicit_confirmation?: boolean;
  selected_time?: string; // RFC 3339 UTC
}

export interface StateMachineState {
  current: State;
  slots: ConversationSlots;
  mandatory_lines: MandatoryLines;
  context: ConversationContext;
  booking_intent?: BookingIntent;
  history: State[];
}

/**
 * Get initial state
 */
export function initialState(context: ConversationContext): StateMachineState {
  return {
    current: 'IdentifyContact',
    slots: {},
    mandatory_lines: {},
    context,
    history: ['IdentifyContact'],
  };
}

/**
 * Check if mandatory lines have been delivered
 */
function checkMandatoryLines(state: StateMachineState, input: StateMachineInput): MandatoryLines {
  const lines = { ...state.mandatory_lines };
  const text = (input.text || '').toLowerCase();

  // Identification check
  if (state.current === 'IdentifyContact' || state.current === 'ConsentGate') {
    if (text.includes('this is') || text.includes('calling from') || (state.context.contact_name && text.includes(state.context.contact_name.toLowerCase()))) {
      lines.identification = true;
    }
  }

  // Purpose check
  if (state.current === 'ConsentGate' || state.current === 'Qualify') {
    if (text.includes('schedule') || text.includes('meeting') || text.includes('discovery')) {
      lines.purpose = true;
    }
  }

  // Consent to proceed check
  if (state.current === 'ConsentGate') {
    if (input.intent === 'consent' || text.includes('yes') || text.includes('sure') || text.includes('ok')) {
      lines.consent_to_proceed = true;
    }
  }

  // Recording consent check (if required)
  if (state.context.recording_required && (state.current === 'ConsentGate' || state.current === 'Qualify')) {
    if (input.intent === 'consent' && text.includes('record')) {
      lines.recording_consent = true;
    }
  }

  return lines;
}

/**
 * Update slots from input
 */
function updateSlots(currentSlots: ConversationSlots, input: StateMachineInput): ConversationSlots {
  const slots = { ...currentSlots };

  if (input.slots) {
    if (input.slots.authority !== undefined) slots.authority = input.slots.authority;
    if (input.slots.need !== undefined) slots.need = input.slots.need;
    if (input.slots.timing !== undefined) slots.timing = input.slots.timing;
    if (input.slots.budget_indicator !== undefined) slots.budget_indicator = input.slots.budget_indicator;
    if (input.slots.confirmed_date !== undefined) slots.confirmed_date = input.slots.confirmed_date;
    if (input.slots.confirmed_time !== undefined) slots.confirmed_time = input.slots.confirmed_time;
    if (input.slots.pain_stated !== undefined) slots.pain_stated = input.slots.pain_stated;
  }

  // Extract from text if slots not provided
  const text = (input.text || '').toLowerCase();
  if (text.includes('decision') || text.includes('authority') || text.includes('decision maker')) {
    slots.authority = true;
  }
  if (text.includes('urgent') || text.includes('immediately') || text.includes('asap')) {
    slots.timing = 'this_quarter';
  }
  if (text.includes('next quarter') || text.includes('q2') || text.includes('q3') || text.includes('q4')) {
    slots.timing = 'next_quarter';
  }

  return slots;
}

/**
 * Check if qualification is complete
 */
function isQualified(slots: ConversationSlots): boolean {
  return (
    slots.authority === true &&
    (slots.need === 'high' || (slots.need === 'medium' && slots.pain_stated === true)) &&
    (slots.timing === 'this_quarter' || slots.timing === 'next_quarter') &&
    (slots.budget_indicator === 'present' || (slots.budget_indicator === 'unknown' && slots.authority === true && slots.need === 'high'))
  );
}

/**
 * Determine next state based on current state and input
 */
export function nextState(
  state: StateMachineState,
  input: StateMachineInput,
): StateMachineState {
  const updatedMandatoryLines = checkMandatoryLines(state, input);
  const updatedSlots = updateSlots(state.slots, input);
  const history = [...state.history];

  let next: State = state.current;
  let bookingIntent: BookingIntent | undefined = state.booking_intent;

  switch (state.current) {
    case 'IdentifyContact':
      // Must deliver identification and purpose before proceeding
      if (updatedMandatoryLines.identification && updatedMandatoryLines.purpose) {
        next = 'ConsentGate';
        history.push('ConsentGate');
      } else if (input.intent === 'transfer') {
        next = 'Transfer';
        history.push('Transfer');
      } else if (input.intent === 'voicemail') {
        next = 'Voicemail';
        history.push('Voicemail');
      }
      break;

    case 'ConsentGate':
      // Must have consent to proceed
      if (!updatedMandatoryLines.consent_to_proceed) {
        // Stay in ConsentGate if no consent
        break;
      }

      // Check recording consent if required
      if (state.context.recording_required && !updatedMandatoryLines.recording_consent) {
        // Stay in ConsentGate if recording consent not obtained
        break;
      }

      if (input.intent === 'opt_out') {
        next = 'OptOut';
        history.push('OptOut');
      } else if (input.intent === 'transfer') {
        next = 'Transfer';
        history.push('Transfer');
      } else {
        next = 'Qualify';
        history.push('Qualify');
      }
      break;

    case 'Qualify':
      if (input.intent === 'opt_out') {
        next = 'OptOut';
        history.push('OptOut');
      } else if (input.intent === 'transfer') {
        next = 'Transfer';
        history.push('Transfer');
      } else if (input.intent === 'disqualify') {
        next = 'End';
        history.push('End');
      } else if (isQualified(updatedSlots)) {
        next = 'ProposeTime';
        history.push('ProposeTime');
      }
      break;

    case 'ProposeTime':
      if (input.intent === 'opt_out') {
        next = 'OptOut';
        history.push('OptOut');
      } else if (input.intent === 'transfer') {
        next = 'Transfer';
        history.push('Transfer');
      } else if (input.intent === 'confirm' && input.selected_time && input.explicit_confirmation) {
        // Update slots with confirmed time
        updatedSlots.confirmed_time = input.selected_time;
        updatedSlots.confirmed_date = input.selected_time;
        next = 'Confirm';
        history.push('Confirm');
      }
      break;

    case 'Confirm':
      // Generate BookingIntent only after explicit confirmation
      if (input.explicit_confirmation && updatedSlots.confirmed_time && updatedSlots.confirmed_date) {
        bookingIntent = {
          booking_id: `booking-${state.context.call_id}`,
          lead_id: state.context.lead_id,
          confirmed_date: updatedSlots.confirmed_date,
          confirmed_time: updatedSlots.confirmed_time,
          qualification_flags: updatedSlots,
          explicit_confirmation: true,
        };
        next = 'End';
        history.push('End');
      } else if (input.intent === 'opt_out') {
        next = 'OptOut';
        history.push('OptOut');
      } else if (input.intent === 'transfer') {
        next = 'Transfer';
        history.push('Transfer');
      }
      break;

    case 'OptOut':
    case 'Transfer':
    case 'Voicemail':
    case 'End':
      // Terminal states - no transitions
      break;
  }

  return {
    current: next,
    slots: updatedSlots,
    mandatory_lines: updatedMandatoryLines,
    context: state.context,
    booking_intent: bookingIntent,
    history,
  };
}

/**
 * Check if state is terminal
 */
export function isTerminalState(state: State): boolean {
  return ['OptOut', 'Transfer', 'Voicemail', 'End'].includes(state);
}

/**
 * Get required mandatory line for current state
 */
export function getRequiredMandatoryLine(state: State): keyof MandatoryLines | null {
  switch (state) {
    case 'IdentifyContact':
      return 'identification';
    case 'ConsentGate':
      return 'consent_to_proceed';
    default:
      return null;
  }
}

