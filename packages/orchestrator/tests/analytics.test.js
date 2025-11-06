import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { emitCallStarted, emitCallConnected, emitBookingCreated, emitCalendarEventCreated, emitCRMActivityWritten, emitConfirmationSent, readEvents, EVENTS_LOG, } from '../src/analytics/bus';
import { existsSync, unlinkSync } from 'fs';
describe('Analytics Bus', () => {
    beforeEach(() => {
        // Clear events log file
        if (existsSync(EVENTS_LOG)) {
            unlinkSync(EVENTS_LOG);
        }
    });
    describe('Event Emission', () => {
        it('writes call_started event to JSONL file', () => {
            emitCallStarted('call-123', 'lead-456', 1, 'manager-789');
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('call_started');
            expect(events[0].attributes).toMatchObject({
                call_id: 'call-123',
                lead_id: 'lead-456',
                attempt_no: 1,
            });
        });
        it('writes call_connected event', () => {
            emitCallConnected('call-123', 'lead-456', 'connected');
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('call_connected');
            expect(events[0].attributes).toMatchObject({
                call_id: 'call-123',
                lead_id: 'lead-456',
                status: 'connected',
            });
        });
        it('writes booking_created event', () => {
            emitBookingCreated('booking-123', 'lead-456', 'manager-789', 'booked');
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('booking_created');
            expect(events[0].attributes).toMatchObject({
                booking_id: 'booking-123',
                outcome: 'booked',
            });
        });
        it('writes calendar_event_created event', () => {
            emitCalendarEventCreated('meeting-123', 'manager-789', 'booking-123', true);
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('calendar_event_created');
            expect(events[0].attributes).toMatchObject({
                meeting_id: 'meeting-123',
                success: true,
            });
        });
        it('writes crm_activity_written event', () => {
            emitCRMActivityWritten('booking-123', 'task-456', true);
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('crm_activity_written');
            expect(events[0].attributes).toMatchObject({
                booking_id: 'booking-123',
                success: true,
            });
        });
        it('writes confirmation_sent event', () => {
            emitConfirmationSent('message-123', 'booking-123', 'email', true);
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('confirmation_sent');
            expect(events[0].attributes).toMatchObject({
                message_id: 'message-123',
                channel: 'email',
                success: true,
            });
        });
        it('writes opt_out event', () => {
            emitOptOut('lead-456', 'call-123');
            const events = readEvents();
            expect(events.length).toBe(1);
            expect(events[0].event_type).toBe('opt_out');
            expect(events[0].attributes).toMatchObject({
                lead_id: 'lead-456',
                call_id: 'call-123',
            });
        });
    });
    describe('JSONL Format', () => {
        it('writes events in JSONL format (one JSON per line)', () => {
            emitCallStarted('call-1', 'lead-1', 1);
            emitCallConnected('call-1', 'lead-1', 'connected');
            emitBookingCreated('booking-1', 'lead-1', 'manager-1', 'booked');
            const events = readEvents();
            expect(events.length).toBe(3);
            expect(events[0].event_type).toBe('call_started');
            expect(events[1].event_type).toBe('call_connected');
            expect(events[2].event_type).toBe('booking_created');
        });
        it('ensures all events have pii_redacted flag', () => {
            emitCallStarted('call-1', 'lead-1', 1);
            const events = readEvents();
            expect(events[0].pii_redacted).toBe(true);
        });
    });
    describe('GET /metrics/summary', () => {
        it('computes bookings per reached', async () => {
            // Emit events
            emitCallStarted('call-1', 'lead-1', 1);
            emitCallConnected('call-1', 'lead-1', 'connected');
            emitCallStarted('call-2', 'lead-2', 1);
            emitCallConnected('call-2', 'lead-2', 'connected');
            emitCallStarted('call-3', 'lead-3', 1);
            emitBookingCreated('booking-1', 'lead-1', 'manager-1', 'booked');
            emitBookingCreated('booking-2', 'lead-2', 'manager-1', 'booked');
            const res = await request(app).get('/metrics/summary');
            expect(res.status).toBe(200);
            expect(res.body.summary.bookings_per_reached.value).toBe(100); // 2 bookings / 2 reached = 100%
            expect(res.body.summary.bookings_per_reached.bookings).toBe(2);
            expect(res.body.summary.bookings_per_reached.reached_leads).toBe(2);
        });
        it('computes calendar write success rate', async () => {
            emitCalendarEventCreated('meeting-1', 'manager-1', 'booking-1', true);
            emitCalendarEventCreated('meeting-2', 'manager-1', 'booking-2', true);
            emitCalendarEventCreated('meeting-3', 'manager-1', 'booking-3', false);
            const res = await request(app).get('/metrics/summary');
            expect(res.status).toBe(200);
            expect(res.body.summary.calendar_write_success.value).toBeCloseTo(66.67, 1); // 2/3 = 66.67%
            expect(res.body.summary.calendar_write_success.successful).toBe(2);
            expect(res.body.summary.calendar_write_success.total).toBe(3);
        });
        it('returns all event counts', async () => {
            emitCallStarted('call-1', 'lead-1', 1);
            emitCallConnected('call-1', 'lead-1', 'connected');
            emitBookingCreated('booking-1', 'lead-1', 'manager-1', 'booked');
            emitCalendarEventCreated('meeting-1', 'manager-1', 'booking-1', true);
            emitCRMActivityWritten('booking-1', 'task-1', true);
            emitConfirmationSent('message-1', 'booking-1', 'email', true);
            emitOptOut('lead-2');
            const res = await request(app).get('/metrics/summary');
            expect(res.status).toBe(200);
            expect(res.body.counts).toMatchObject({
                call_started: 1,
                call_connected: 1,
                booking_created: 1,
                calendar_event_created: 1,
                crm_activity_written: 1,
                confirmation_sent: 1,
                opt_out: 1,
            });
        });
    });
    describe('Acceptance: Happy Path Simulation', () => {
        it('simulated happy path produces nonzero counts and derived rates', async () => {
            // Simulate happy path: call -> connect -> book -> calendar -> CRM -> confirmation
            const callId = 'call-happy-1';
            const leadId = 'lead-happy-1';
            const managerId = 'manager-happy-1';
            const bookingId = 'booking-happy-1';
            const meetingId = 'meeting-happy-1';
            const taskId = 'task-happy-1';
            const messageId = 'message-happy-1';
            // Step 1: Call started
            emitCallStarted(callId, leadId, 1, managerId);
            // Step 2: Call connected
            emitCallConnected(callId, leadId, 'connected');
            // Step 3: Booking created
            emitBookingCreated(bookingId, leadId, managerId, 'booked');
            // Step 4: Calendar event created
            emitCalendarEventCreated(meetingId, managerId, bookingId, true);
            // Step 5: CRM activity written
            emitCRMActivityWritten(bookingId, taskId, true);
            // Step 6: Confirmation sent
            emitConfirmationSent(messageId, bookingId, 'email', true);
            // Get metrics summary
            const res = await request(app).get('/metrics/summary');
            expect(res.status).toBe(200);
            // Verify nonzero counts
            expect(res.body.counts.call_started).toBeGreaterThan(0);
            expect(res.body.counts.call_connected).toBeGreaterThan(0);
            expect(res.body.counts.booking_created).toBeGreaterThan(0);
            expect(res.body.counts.calendar_event_created).toBeGreaterThan(0);
            expect(res.body.counts.crm_activity_written).toBeGreaterThan(0);
            expect(res.body.counts.confirmation_sent).toBeGreaterThan(0);
            // Verify derived rates are computed
            expect(res.body.summary.bookings_per_reached.value).toBeGreaterThan(0);
            expect(res.body.summary.bookings_per_reached.value).toBe(100); // 1 booking / 1 reached = 100%
            expect(res.body.summary.calendar_write_success.value).toBeGreaterThan(0);
            expect(res.body.summary.calendar_write_success.value).toBe(100); // 1 success / 1 total = 100%
        });
        it('POST /dev/simulate-happy-path produces events and summary returns nonzero rates', async () => {
            const res = await request(app).post('/dev/simulate-happy-path').send({});
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.booking_id).toBeDefined();
            // Wait a moment for events to be written
            await new Promise((resolve) => setTimeout(resolve, 100));
            // Get metrics summary
            const summaryRes = await request(app).get('/metrics/summary');
            expect(summaryRes.status).toBe(200);
            // Verify nonzero counts
            expect(summaryRes.body.counts.call_started).toBeGreaterThan(0);
            expect(summaryRes.body.counts.call_connected).toBeGreaterThan(0);
            expect(summaryRes.body.counts.booking_created).toBeGreaterThan(0);
            expect(summaryRes.body.counts.calendar_event_created).toBeGreaterThan(0);
            expect(summaryRes.body.counts.crm_activity_written).toBeGreaterThan(0);
            expect(summaryRes.body.counts.confirmation_sent).toBeGreaterThan(0);
            // Verify derived rates are nonzero
            expect(summaryRes.body.summary.bookings_per_reached.value).toBeGreaterThan(0);
            expect(summaryRes.body.summary.calendar_write_success.value).toBeGreaterThan(0);
        });
        it('handles multiple bookings correctly', async () => {
            // Simulate multiple calls and bookings
            for (let i = 1; i <= 5; i++) {
                const callId = `call-${i}`;
                const leadId = `lead-${i}`;
                const managerId = 'manager-1';
                const bookingId = `booking-${i}`;
                emitCallStarted(callId, leadId, 1, managerId);
                emitCallConnected(callId, leadId, 'connected');
                emitBookingCreated(bookingId, leadId, managerId, 'booked');
                emitCalendarEventCreated(`meeting-${i}`, managerId, bookingId, true);
            }
            const res = await request(app).get('/metrics/summary');
            expect(res.status).toBe(200);
            expect(res.body.counts.call_started).toBe(5);
            expect(res.body.counts.call_connected).toBe(5);
            expect(res.body.counts.booking_created).toBe(5);
            expect(res.body.summary.bookings_per_reached.value).toBe(100); // 5 bookings / 5 reached
            expect(res.body.summary.calendar_write_success.value).toBe(100); // 5 successes / 5 total
        });
        it('handles partial success rates', async () => {
            // Some calls don't result in bookings
            emitCallStarted('call-1', 'lead-1', 1);
            emitCallConnected('call-1', 'lead-1', 'connected');
            emitCallStarted('call-2', 'lead-2', 1);
            emitCallConnected('call-2', 'lead-2', 'connected');
            emitCallStarted('call-3', 'lead-3', 1);
            emitCallConnected('call-3', 'lead-3', 'connected');
            // Only one booking
            emitBookingCreated('booking-1', 'lead-1', 'manager-1', 'booked');
            // Some calendar events fail
            emitCalendarEventCreated('meeting-1', 'manager-1', 'booking-1', true);
            emitCalendarEventCreated('meeting-2', 'manager-1', 'booking-2', false);
            const res = await request(app).get('/metrics/summary');
            expect(res.status).toBe(200);
            expect(res.body.summary.bookings_per_reached.value).toBeCloseTo(33.33, 1); // 1 booking / 3 reached
            expect(res.body.summary.calendar_write_success.value).toBeCloseTo(50, 1); // 1 success / 2 total
        });
    });
});
