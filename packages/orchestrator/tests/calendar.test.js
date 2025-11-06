import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { getAvailability, placeHold, createEvent, eventStore, holdStore, managerEvents, managerHolds, } from '../src/calendar/service';
describe('Calendar Service', () => {
    const managerId = '0051234567890XYZ';
    beforeEach(() => {
        // Clear stores before each test
        eventStore.clear();
        holdStore.clear();
        managerEvents.clear();
        managerHolds.clear();
    });
    describe('getAvailability', () => {
        it('returns available slots within window', () => {
            const window = {
                from: '2024-03-15T09:00:00.000Z',
                to: '2024-03-15T17:00:00.000Z',
            };
            const slots = getAvailability(managerId, window);
            expect(slots.length).toBeGreaterThan(0);
            expect(slots[0].available).toBe(true);
            expect(slots[0].start_utc).toBeDefined();
            expect(slots[0].end_utc).toBeDefined();
        });
        it('marks slots as unavailable when overlap exists', () => {
            // Place a hold
            const holdResult = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T10:00:00.000Z',
                end_utc: '2024-03-15T10:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(holdResult.success).toBe(true);
            const window = {
                from: '2024-03-15T09:00:00.000Z',
                to: '2024-03-15T12:00:00.000Z',
            };
            const slots = getAvailability(managerId, window);
            // Find the slot that overlaps (considering 10-minute buffer)
            const overlappingSlot = slots.find((slot) => slot.start_utc === '2024-03-15T09:30:00.000Z' ||
                slot.start_utc === '2024-03-15T10:00:00.000Z' ||
                slot.start_utc === '2024-03-15T10:30:00.000Z');
            expect(overlappingSlot).toBeDefined();
            if (overlappingSlot) {
                expect(overlappingSlot.available).toBe(false);
            }
        });
    });
    describe('placeHold', () => {
        it('places a hold successfully', () => {
            const result = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(result.success).toBe(true);
            expect(result.tentative_id).toBeDefined();
            const hold = holdStore.get(result.tentative_id);
            expect(hold).toBeDefined();
            expect(hold?.hold.manager_id).toBe(managerId);
        });
        it('rejects hold with invalid TTL', () => {
            const result = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 100, // Too short
            });
            expect(result.success).toBe(false);
            expect(result.error).toContain('ttl_seconds');
        });
        it('rejects hold with overlap', () => {
            // Place first hold
            const firstResult = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(firstResult.success).toBe(true);
            // Try to place overlapping hold (within 10-minute buffer)
            const secondResult = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:25:00.000Z', // Overlaps with buffer
                end_utc: '2024-03-15T14:55:00.000Z',
                ttl_seconds: 1800,
            });
            expect(secondResult.success).toBe(false);
            expect(secondResult.error).toContain('overlap');
        });
    });
    describe('createEvent', () => {
        it('creates event successfully', () => {
            const event = {
                meeting_id: '550e8400-e29b-41d4-a716-446655440000',
                manager_id: managerId,
                contact_email: 'prospect@acme.com',
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com', 'prospect@acme.com'],
                source_system: 'ai-outbound',
                iCal_uid: undefined, // Will be generated
            };
            const result = createEvent(event);
            expect(result.success).toBe(true);
            expect(result.meeting_url).toBeDefined();
            expect(result.meeting_url).toContain('meet.example.com');
            const storedEvent = eventStore.get(event.meeting_id);
            expect(storedEvent).toBeDefined();
            expect(storedEvent?.iCal_uid).toBeDefined();
        });
        it('generates deterministic iCal_uid', () => {
            const bookingId = '550e8400-e29b-41d4-a716-446655440000';
            const startUtc = '2024-03-15T14:00:00.000Z';
            const event1 = {
                meeting_id: bookingId,
                manager_id: managerId,
                contact_email: null,
                title: 'Discovery Meeting',
                start_utc: startUtc,
                end_utc: '2024-03-15T14:30:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
                iCal_uid: undefined,
            };
            const result1 = createEvent(event1);
            expect(result1.success).toBe(true);
            expect(result1.iCal_uid).toBeDefined();
            const stored1 = eventStore.get(bookingId);
            expect(stored1?.iCal_uid).toBeDefined();
            const firstIcalUid = stored1.iCal_uid;
            // Clear and create again with same booking_id and start_utc
            eventStore.clear();
            managerEvents.clear();
            const event2 = {
                ...event1,
                meeting_id: bookingId,
                iCal_uid: undefined, // Will be generated
            };
            const result2 = createEvent(event2);
            expect(result2.success).toBe(true);
            expect(result2.iCal_uid).toBeDefined();
            const stored2 = eventStore.get(bookingId);
            expect(stored2?.iCal_uid).toBeDefined();
            // The iCal_uid should be the same (deterministic)
            expect(stored2?.iCal_uid).toBe(firstIcalUid);
            expect(result2.iCal_uid).toBe(firstIcalUid);
        });
        it('rejects event with overlap (including buffers)', () => {
            // Place a hold
            const holdResult = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(holdResult.success).toBe(true);
            // Try to create event that overlaps with buffer
            const event = {
                meeting_id: '550e8400-e29b-41d4-a716-446655440001',
                manager_id: managerId,
                contact_email: null,
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T14:25:00.000Z', // Overlaps with buffer
                end_utc: '2024-03-15T14:55:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
            };
            const result = createEvent(event);
            expect(result.success).toBe(false);
            expect(result.error).toContain('overlap');
        });
        it('expires hold when event is created', () => {
            // Place a hold
            const holdResult = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(holdResult.success).toBe(true);
            const tentativeId = holdResult.tentative_id;
            expect(holdStore.has(tentativeId)).toBe(true);
            // Create event at same time
            const event = {
                meeting_id: '550e8400-e29b-41d4-a716-446655440000',
                manager_id: managerId,
                contact_email: null,
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
            };
            const result = createEvent(event);
            expect(result.success).toBe(true);
            // Hold should be expired/removed
            expect(holdStore.has(tentativeId)).toBe(false);
        });
    });
    describe('Acceptance: Hold and Event with Buffers', () => {
        it('respects 10 minute buffers when placing hold then creating event', () => {
            // Place a hold
            const holdResult = placeHold({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(holdResult.success).toBe(true);
            // Try to create event that would overlap with buffer (9 minutes before end = within buffer)
            const event1 = {
                meeting_id: '550e8400-e29b-41d4-a716-446655440001',
                manager_id: managerId,
                contact_email: null,
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T13:51:00.000Z', // 9 minutes before hold start (within 10-min buffer)
                end_utc: '2024-03-15T14:21:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
            };
            const result1 = createEvent(event1);
            expect(result1.success).toBe(false);
            expect(result1.error).toContain('overlap');
            // Try to create event that overlaps at the end (within buffer)
            const event2 = {
                meeting_id: '550e8400-e29b-41d4-a716-446655440002',
                manager_id: managerId,
                contact_email: null,
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T14:21:00.000Z', // 9 minutes after hold start (within 10-min buffer)
                end_utc: '2024-03-15T14:51:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
            };
            const result2 = createEvent(event2);
            expect(result2.success).toBe(false);
            expect(result2.error).toContain('overlap');
            // Create event that respects buffer (starts 11 minutes after hold ends)
            const event3 = {
                meeting_id: '550e8400-e29b-41d4-a716-446655440003',
                manager_id: managerId,
                contact_email: null,
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T14:41:00.000Z', // 11 minutes after hold end (outside buffer)
                end_utc: '2024-03-15T15:11:00.000Z',
                location: null,
                meeting_url: null,
                timezone: 'America/New_York',
                description: null,
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
            };
            const result3 = createEvent(event3);
            expect(result3.success).toBe(true);
        });
    });
    describe('API Routes', () => {
        it('GET /availability returns slots', async () => {
            const res = await request(app).get('/availability').query({
                manager_id: managerId,
                from: '2024-03-15T09:00:00.000Z',
                to: '2024-03-15T17:00:00.000Z',
            });
            expect(res.status).toBe(200);
            expect(res.body.manager_id).toBe(managerId);
            expect(res.body.slots).toBeDefined();
            expect(Array.isArray(res.body.slots)).toBe(true);
        });
        it('POST /holds places a hold', async () => {
            const res = await request(app).post('/holds').send({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                ttl_seconds: 1800,
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.tentative_id).toBeDefined();
        });
        it('POST /events creates an event', async () => {
            const res = await request(app).post('/events').send({
                meeting_id: '550e8400-e29b-41d4-a716-446655440000',
                manager_id: managerId,
                title: 'Discovery Meeting',
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T14:30:00.000Z',
                timezone: 'America/New_York',
                invitees_emails: ['manager@company.com'],
                source_system: 'ai-outbound',
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.meeting_url).toBeDefined();
            expect(res.body.iCal_uid).toBeDefined();
        });
    });
});
