import { describe, it, expect } from '@jest/globals';
import { initialState, nextState, isTerminalState, getRequiredMandatoryLine, type StateMachineInput } from '../src/agent/stateMachine';

describe('Conversation State Machine', () => {
  const baseContext = {
    call_id: '550e8400-e29b-41d4-a716-446655440000',
    lead_id: '00Q1234567890ABC',
    contact_name: 'John Doe',
    company_name: 'Acme Corp',
    recording_required: false,
  };

  describe('Happy Path', () => {
    it('completes full booking flow with explicit confirmation', () => {
      let state = initialState(baseContext);

      // Step 1: IdentifyContact -> ConsentGate
      state = nextState(state, {
        text: 'Hello, this is John Doe from Acme Corp. I am calling to schedule a discovery meeting.',
        intent: 'identify',
      });
      expect(state.current).toBe('ConsentGate');
      expect(state.mandatory_lines.identification).toBe(true);
      expect(state.mandatory_lines.purpose).toBe(true);

      // Step 2: ConsentGate -> Qualify
      state = nextState(state, {
        text: 'Yes, I have a few minutes to talk.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');
      expect(state.mandatory_lines.consent_to_proceed).toBe(true);

      // Step 3: Qualify (populate slots)
      state = nextState(state, {
        slots: {
          authority: true,
          need: 'high',
          timing: 'this_quarter',
          budget_indicator: 'present',
        },
      });
      expect(state.current).toBe('ProposeTime');
      expect(state.slots.authority).toBe(true);
      expect(state.slots.need).toBe('high');

      // Step 4: ProposeTime -> Confirm
      const selectedTime = '2024-03-15T19:00:00.000Z';
      state = nextState(state, {
        intent: 'confirm',
        selected_time: selectedTime,
        explicit_confirmation: true,
      });
      expect(state.current).toBe('Confirm');
      expect(state.slots.confirmed_time).toBe(selectedTime);

      // Step 5: Confirm -> End (generate BookingIntent)
      state = nextState(state, {
        explicit_confirmation: true,
        text: 'Yes, Tuesday at 2 PM works for me.',
      });
      expect(state.current).toBe('End');
      expect(state.booking_intent).toBeDefined();
      expect(state.booking_intent?.explicit_confirmation).toBe(true);
      expect(state.booking_intent?.confirmed_time).toBe(selectedTime);
      expect(state.booking_intent?.qualification_flags.authority).toBe(true);
    });

    it('does not generate BookingIntent without explicit confirmation', () => {
      let state = initialState(baseContext);

      // Go through states up to Confirm
      state = nextState(state, {
        text: 'Hello, this is John Doe from Acme Corp. I am calling to schedule a discovery meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have a few minutes.',
        intent: 'consent',
      });
      state = nextState(state, {
        slots: {
          authority: true,
          need: 'high',
          timing: 'this_quarter',
          budget_indicator: 'present',
        },
      });
      const selectedTime = '2024-03-15T19:00:00.000Z';
      state = nextState(state, {
        intent: 'confirm',
        selected_time: selectedTime,
        explicit_confirmation: true,
      });
      expect(state.current).toBe('Confirm');

      // Try to transition without explicit confirmation
      state = nextState(state, {
        text: 'That sounds good',
        // explicit_confirmation: false (implicit)
      });
      expect(state.current).toBe('Confirm'); // Stay in Confirm
      expect(state.booking_intent).toBeUndefined();

      // Now with explicit confirmation
      state = nextState(state, {
        explicit_confirmation: true,
        text: 'Yes, I confirm Tuesday at 2 PM.',
      });
      expect(state.current).toBe('End');
      expect(state.booking_intent).toBeDefined();
    });
  });

  describe('Opt-Out Path', () => {
    it('transitions to OptOut from any state', () => {
      let state = initialState(baseContext);

      // Opt-out from ConsentGate
      state = nextState(state, {
        text: 'Hello, this is John Doe from Acme Corp.',
        intent: 'identify',
      });
      expect(state.current).toBe('ConsentGate');

      state = nextState(state, {
        intent: 'opt_out',
        text: 'Please remove me from your list.',
      });
      expect(state.current).toBe('OptOut');
      expect(isTerminalState(state.current)).toBe(true);
    });

    it('transitions to OptOut from Qualify', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');

      state = nextState(state, {
        intent: 'opt_out',
        text: 'No thanks, remove me.',
      });
      expect(state.current).toBe('OptOut');
    });

    it('transitions to OptOut from ProposeTime', () => {
      let state = initialState(baseContext);
      // Quick path to ProposeTime
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      state = nextState(state, {
        slots: {
          authority: true,
          need: 'high',
          timing: 'this_quarter',
          budget_indicator: 'present',
        },
      });
      expect(state.current).toBe('ProposeTime');

      state = nextState(state, {
        intent: 'opt_out',
        text: 'I am not interested, please remove me.',
      });
      expect(state.current).toBe('OptOut');
    });
  });

  describe('Transfer Path', () => {
    it('transitions to Transfer from any state', () => {
      let state = initialState(baseContext);

      // Transfer from IdentifyContact
      state = nextState(state, {
        intent: 'transfer',
        text: 'I need to speak with a human agent.',
      });
      expect(state.current).toBe('Transfer');
      expect(isTerminalState(state.current)).toBe(true);
    });

    it('transitions to Transfer from Qualify', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');

      state = nextState(state, {
        intent: 'transfer',
        text: 'Can I speak with someone?',
      });
      expect(state.current).toBe('Transfer');
    });
  });

  describe('Disqualification Path', () => {
    it('transitions to End from Qualify when disqualified', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');

      // Disqualify - no authority, low need, later timing
      state = nextState(state, {
        intent: 'disqualify',
        slots: {
          authority: false,
          need: 'low',
          timing: 'later',
        },
      });
      expect(state.current).toBe('End');
      expect(isTerminalState(state.current)).toBe(true);
      expect(state.booking_intent).toBeUndefined();
    });

    it('does not transition from Qualify if not qualified and not disqualified', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');

      // Partial qualification - not enough info
      state = nextState(state, {
        slots: {
          authority: true,
          // Missing need, timing, budget
        },
      });
      expect(state.current).toBe('Qualify'); // Stay in Qualify
    });
  });

  describe('Mandatory Lines Enforcement', () => {
    it('requires identification before leaving IdentifyContact', () => {
      let state = initialState(baseContext);

      // Try to transition without identification
      state = nextState(state, {
        text: 'Hello',
        intent: 'identify',
      });
      expect(state.current).toBe('IdentifyContact'); // Stays in IdentifyContact

      // Now with identification
      state = nextState(state, {
        text: 'Hello, this is John Doe from Acme Corp. I am calling to schedule a discovery meeting.',
        intent: 'identify',
      });
      expect(state.current).toBe('ConsentGate');
    });

    it('requires consent to proceed before leaving ConsentGate', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe from Acme Corp. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      expect(state.current).toBe('ConsentGate');

      // Try without consent
      state = nextState(state, {
        text: 'What is this about?',
      });
      expect(state.current).toBe('ConsentGate'); // Stays

      // Now with consent
      state = nextState(state, {
        text: 'Yes, I have a few minutes.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');
    });

    it('requires recording consent when recording_required is true', () => {
      const contextWithRecording = {
        ...baseContext,
        recording_required: true,
      };
      let state = initialState(contextWithRecording);
      state = nextState(state, {
        text: 'Hello, this is John Doe from Acme Corp. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      expect(state.current).toBe('ConsentGate');

      // Consent to proceed but not recording
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      expect(state.current).toBe('ConsentGate'); // Stays until recording consent

      // Now with recording consent
      state = nextState(state, {
        text: 'Yes, you may record this call.',
        intent: 'consent',
      });
      expect(state.current).toBe('Qualify');
      expect(state.mandatory_lines.recording_consent).toBe(true);
    });
  });

  describe('Slot Population', () => {
    it('populates slots from input', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });

      state = nextState(state, {
        slots: {
          authority: true,
          need: 'high',
          timing: 'this_quarter',
          budget_indicator: 'present',
        },
      });

      expect(state.slots.authority).toBe(true);
      expect(state.slots.need).toBe('high');
      expect(state.slots.timing).toBe('this_quarter');
      expect(state.slots.budget_indicator).toBe('present');
    });

    it('extracts slots from text when not provided', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });

      state = nextState(state, {
        text: 'I am the decision maker and we need this urgently, as soon as possible.',
      });

      expect(state.slots.authority).toBe(true);
      expect(state.slots.timing).toBe('this_quarter');
    });
  });

  describe('Qualification Logic', () => {
    it('transitions to ProposeTime when fully qualified', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });

      // Fully qualified
      state = nextState(state, {
        slots: {
          authority: true,
          need: 'high',
          timing: 'this_quarter',
          budget_indicator: 'present',
        },
      });

      expect(state.current).toBe('ProposeTime');
    });

    it('allows medium need with pain stated', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });

      state = nextState(state, {
        slots: {
          authority: true,
          need: 'medium',
          pain_stated: true,
          timing: 'this_quarter',
          budget_indicator: 'present',
        },
      });

      expect(state.current).toBe('ProposeTime');
    });

    it('allows unknown budget with high authority and need', () => {
      let state = initialState(baseContext);
      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });

      state = nextState(state, {
        slots: {
          authority: true,
          need: 'high',
          timing: 'this_quarter',
          budget_indicator: 'unknown',
        },
      });

      expect(state.current).toBe('ProposeTime');
    });
  });

  describe('Helper Functions', () => {
    it('identifies terminal states', () => {
      expect(isTerminalState('OptOut')).toBe(true);
      expect(isTerminalState('Transfer')).toBe(true);
      expect(isTerminalState('Voicemail')).toBe(true);
      expect(isTerminalState('End')).toBe(true);
      expect(isTerminalState('Qualify')).toBe(false);
      expect(isTerminalState('ProposeTime')).toBe(false);
    });

    it('returns required mandatory line for state', () => {
      expect(getRequiredMandatoryLine('IdentifyContact')).toBe('identification');
      expect(getRequiredMandatoryLine('ConsentGate')).toBe('consent_to_proceed');
      expect(getRequiredMandatoryLine('Qualify')).toBe(null);
    });
  });

  describe('State History', () => {
    it('tracks state transitions in history', () => {
      let state = initialState(baseContext);
      expect(state.history).toEqual(['IdentifyContact']);

      state = nextState(state, {
        text: 'Hello, this is John Doe. I am calling to schedule a meeting.',
        intent: 'identify',
      });
      expect(state.history).toContain('ConsentGate');

      state = nextState(state, {
        text: 'Yes, I have time.',
        intent: 'consent',
      });
      expect(state.history).toContain('Qualify');
      expect(state.history.length).toBe(3);
    });
  });

  describe('Voicemail Path', () => {
    it('transitions to Voicemail from IdentifyContact', () => {
      let state = initialState(baseContext);

      state = nextState(state, {
        intent: 'voicemail',
      });

      expect(state.current).toBe('Voicemail');
      expect(isTerminalState(state.current)).toBe(true);
    });
  });
});

