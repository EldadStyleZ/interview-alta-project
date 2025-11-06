import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { bookingStore } from '../src/booking/store';
import { outbox } from '../src/messaging/outbox';
import { eventStore } from '../src/calendar/service';
import { taskStore } from '../src/crm/salesforceMock';
import { holdStore } from '../src/calendar/service';
describe('POST /book', () => {
    const managerId = '0051234567890XYZ';
    const leadId = '00Q1234567890ABC';
    beforeEach(() => {
        // Clear all stores
        bookingStore.clear();
        outbox.length = 0;
        eventStore.clear();
        taskStore.clear();
        holdStore.clear();
    });
    describe('Acceptance: Full booking flow', () => {
        it('single request produces hold, event, CRM task, and queued confirmation', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                confirm: true,
                explicit_confirmation: true,
                confirmed_date: '2024-03-15T14:00:00.000Z',
                confirmed_time: '2024-03-15T14:00:00.000Z',
                qualification_flags: {
                    budget: true,
                    authority: true,
                    need: 'high',
                    timeline: 'this_quarter',
                },
                call_id: '660e8400-e29b-41d4-a716-446655440001',
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.booking_id).toBeDefined();
            expect(res.body.meeting_id).toBeDefined();
            expect(res.body.tentative_id).toBeDefined();
            expect(res.body.task_id).toBeDefined();
            expect(res.body.confirmation_message_id).toBeDefined();
            // Verify artifacts are stored on Booking record
            const booking = bookingStore.get(res.body.booking_id);
            expect(booking).toBeDefined();
            expect(booking?.artifacts.tentative_id).toBe(res.body.tentative_id);
            expect(booking?.artifacts.meeting_id).toBe(res.body.meeting_id);
            expect(booking?.artifacts.task_id).toBe(res.body.task_id);
            expect(booking?.artifacts.confirmation_message_ids).toContain(res.body.confirmation_message_id);
            // Verify hold was created
            expect(holdStore.has(res.body.tentative_id)).toBe(true);
            // Verify event was created
            expect(eventStore.has(res.body.meeting_id)).toBe(true);
            // Verify CRM task was created
            expect(taskStore.has(res.body.booking_id)).toBe(true);
            // Verify confirmation message was queued
            const queuedMessages = outbox.filter((entry) => entry.status === 'queued');
            expect(queuedMessages.length).toBeGreaterThan(0);
            expect(queuedMessages.some((entry) => entry.message_id === res.body.confirmation_message_id)).toBe(true);
        });
        it('stores all artifacts on Booking record', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                confirm: true,
                explicit_confirmation: true,
                confirmed_date: '2024-03-15T14:00:00.000Z',
                confirmed_time: '2024-03-15T14:00:00.000Z',
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(200);
            const booking = bookingStore.get(res.body.booking_id);
            expect(booking).toBeDefined();
            expect(booking?.artifacts).toMatchObject({
                tentative_id: expect.any(String),
                meeting_id: expect.any(String),
                task_id: expect.any(String),
                confirmation_message_ids: expect.any(Array),
            });
            expect(booking?.artifacts.confirmation_message_ids?.length).toBeGreaterThan(0);
        });
    });
    describe('Hold-only flow (no confirm)', () => {
        it('places hold without creating event or CRM task', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                confirm: false,
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.booking_id).toBeDefined();
            expect(res.body.tentative_id).toBeDefined();
            expect(res.body.status).toBe('hold_placed');
            expect(res.body.meeting_id).toBeUndefined();
            expect(res.body.task_id).toBeUndefined();
            expect(res.body.confirmation_message_id).toBeUndefined();
            // Verify hold was created
            expect(holdStore.has(res.body.tentative_id)).toBe(true);
            // Verify event was NOT created
            expect(eventStore.size).toBe(0);
            // Verify CRM task was NOT created
            expect(taskStore.size).toBe(0);
            // Verify confirmation was NOT queued
            expect(outbox.length).toBe(0);
        });
    });
    describe('Policy validation', () => {
        it('rejects booking without explicit confirmation', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                confirm: true,
                // explicit_confirmation: false (missing)
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
            expect(res.body.error).toContain('Pre-booking validation failed');
        });
        it('rejects booking without qualification flags', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                confirm: true,
                explicit_confirmation: true,
                confirmed_date: '2024-03-15T14:00:00.000Z',
                confirmed_time: '2024-03-15T14:00:00.000Z',
                // qualification_flags: missing
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
            expect(res.body.error).toContain('Pre-booking validation failed');
        });
        it('rejects booking without confirmed date/time', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                confirm: true,
                explicit_confirmation: true,
                // confirmed_date: missing
                // confirmed_time: missing
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
            expect(res.body.error).toContain('Pre-booking validation failed');
        });
    });
    describe('Slot selection', () => {
        it('returns error when no available slots in preferred windows', async () => {
            // First, fill up the time slots
            const holdResult = await request(app).post('/holds').send({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T18:00:00.000Z',
                ttl_seconds: 1800,
            });
            expect(holdResult.status).toBe(200);
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('No available slots');
        });
        it('selects first available slot from preferred windows', async () => {
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T15:00:00.000Z',
                    },
                    {
                        from: '2024-03-15T16:00:00.000Z',
                        to: '2024-03-15T17:00:00.000Z',
                    },
                ],
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(200);
            expect(res.body.tentative_id).toBeDefined();
        });
    });
    describe('Error handling', () => {
        it('returns 400 for missing required fields', async () => {
            const res = await request(app).post('/book').send({
                lead_id: leadId,
                // Missing manager_id and preferred_windows
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
        });
        it('handles calendar hold failure gracefully', async () => {
            // Fill up all slots
            await request(app).post('/holds').send({
                manager_id: managerId,
                start_utc: '2024-03-15T14:00:00.000Z',
                end_utc: '2024-03-15T18:00:00.000Z',
                ttl_seconds: 1800,
            });
            const payload = {
                lead_id: leadId,
                manager_id: managerId,
                preferred_windows: [
                    {
                        from: '2024-03-15T14:00:00.000Z',
                        to: '2024-03-15T18:00:00.000Z',
                    },
                ],
                qualification_flags: {
                    budget: true,
                    authority: true,
                },
            };
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
        });
    });
});
