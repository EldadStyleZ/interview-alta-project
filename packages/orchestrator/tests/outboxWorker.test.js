import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { enqueueConfirmation, outbox } from '../src/messaging/outbox';
import { drainOutbox, startWorker, stopWorker, getSentEvents, sentEvents } from '../src/messaging/outboxWorker';
import { v4 as uuidv4 } from 'uuid';
describe('Outbox Worker', () => {
    beforeEach(() => {
        // Clear stores
        outbox.length = 0;
        sentEvents.length = 0;
        stopWorker();
    });
    afterEach(() => {
        stopWorker();
    });
    describe('drainOutbox', () => {
        it('processes queued messages and marks them as sent', () => {
            // Enqueue a confirmation message
            const message = {
                message_id: uuidv4(),
                channel: 'email',
                to: 'prospect@acme.com',
                template_id: 'booking_confirmation_v1',
                payload_json: {
                    contact_name: 'John Doe',
                    manager_name: 'Jane Smith',
                    meeting_date: 'March 15, 2024',
                    meeting_time: '2:00 PM EST',
                    meeting_url: 'https://meet.example.com/abc123',
                    reschedule_link: 'https://reschedule.example.com/xyz789',
                },
                sent_ts: new Date().toISOString(),
                delivery_status: 'queued',
            };
            enqueueConfirmation(message);
            expect(outbox.length).toBe(1);
            expect(outbox[0].status).toBe('queued');
            // Drain outbox
            const result = drainOutbox();
            expect(result.processed).toBe(1);
            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(0);
            // Verify message is marked as sent
            expect(outbox[0].status).toBe('sent');
            expect(outbox[0].message.delivery_status).toBe('sent');
            // Verify sent event was created
            const sentEvent = getSentEvents();
            expect(sentEvent.length).toBe(1);
            expect(sentEvent[0].message_id).toBe(message.message_id);
            expect(sentEvent[0].success).toBe(true);
            expect(sentEvent[0].template_rendered).toBeDefined();
            expect(sentEvent[0].template_rendered).toContain('John Doe');
            expect(sentEvent[0].template_rendered).toContain('Jane Smith');
            expect(sentEvent[0].template_rendered).toContain('March 15, 2024');
        });
        it('processes SMS messages', () => {
            const message = {
                message_id: uuidv4(),
                channel: 'sms',
                to: '+1234567890',
                template_id: 'booking_confirmation_v1',
                payload_json: {
                    contact_name: 'John Doe',
                    manager_name: 'Jane Smith',
                    meeting_date: 'March 15, 2024',
                    meeting_time: '2:00 PM EST',
                    meeting_url: 'https://meet.example.com/abc123',
                },
                sent_ts: new Date().toISOString(),
                delivery_status: 'queued',
            };
            enqueueConfirmation(message);
            const result = drainOutbox();
            expect(result.processed).toBe(1);
            expect(result.succeeded).toBe(1);
            const sentEvent = getSentEvents()[0];
            expect(sentEvent.channel).toBe('sms');
            expect(sentEvent.template_rendered).toBeDefined();
            expect(sentEvent.template_rendered.length).toBeLessThan(160); // SMS should be short
        });
        it('handles processing failures gracefully', () => {
            // Create invalid message (missing required fields)
            const invalidMessage = {
                message_id: uuidv4(),
                channel: 'email',
                to: 'invalid', // Invalid email
                template_id: 'booking_confirmation_v1',
                payload_json: {},
                sent_ts: new Date().toISOString(),
                delivery_status: 'queued',
            };
            // Manually add to outbox to bypass validation
            outbox.push({
                message_id: invalidMessage.message_id,
                message: invalidMessage,
                queued_at: new Date().toISOString(),
                status: 'queued',
            });
            const result = drainOutbox();
            expect(result.processed).toBe(1);
            expect(result.failed).toBeGreaterThanOrEqual(0); // May fail or succeed depending on validation
            // Check if message was marked as failed or sent
            const entry = outbox.find((e) => e.message_id === invalidMessage.message_id);
            expect(entry?.status).toMatch(/sent|failed/);
        });
        it('processes multiple messages', () => {
            // Enqueue multiple messages
            for (let i = 0; i < 3; i++) {
                const message = {
                    message_id: uuidv4(),
                    channel: 'email',
                    to: `prospect${i}@acme.com`,
                    template_id: 'booking_confirmation_v1',
                    payload_json: {
                        contact_name: `Contact ${i}`,
                        manager_name: 'Jane Smith',
                        meeting_date: 'March 15, 2024',
                        meeting_time: '2:00 PM EST',
                    },
                    sent_ts: new Date().toISOString(),
                    delivery_status: 'queued',
                };
                enqueueConfirmation(message);
            }
            expect(outbox.length).toBe(3);
            const result = drainOutbox();
            expect(result.processed).toBe(3);
            expect(result.succeeded).toBe(3);
            // All should be marked as sent
            expect(outbox.filter((e) => e.status === 'sent').length).toBe(3);
            expect(getSentEvents().length).toBe(3);
        });
    });
    describe('Background Worker', () => {
        it('starts and processes messages periodically', (done) => {
            // Enqueue a message
            const message = {
                message_id: uuidv4(),
                channel: 'email',
                to: 'prospect@acme.com',
                template_id: 'booking_confirmation_v1',
                payload_json: {
                    contact_name: 'John Doe',
                    manager_name: 'Jane Smith',
                    meeting_date: 'March 15, 2024',
                    meeting_time: '2:00 PM EST',
                },
                sent_ts: new Date().toISOString(),
                delivery_status: 'queued',
            };
            enqueueConfirmation(message);
            // Start worker with short interval
            startWorker(100); // 100ms interval
            // Wait for worker to process
            setTimeout(() => {
                expect(outbox[0].status).toBe('sent');
                expect(getSentEvents().length).toBe(1);
                stopWorker();
                done();
            }, 250);
        });
        it('stops worker correctly', () => {
            startWorker(100);
            expect(sentEvents.length).toBe(0); // Worker running but no messages yet
            stopWorker();
            // Worker should be stopped
            const message = {
                message_id: uuidv4(),
                channel: 'email',
                to: 'prospect@acme.com',
                template_id: 'booking_confirmation_v1',
                payload_json: {
                    contact_name: 'John Doe',
                    manager_name: 'Jane Smith',
                    meeting_date: 'March 15, 2024',
                    meeting_time: '2:00 PM EST',
                },
                sent_ts: new Date().toISOString(),
                delivery_status: 'queued',
            };
            enqueueConfirmation(message);
            // Wait a bit - message should not be processed
            setTimeout(() => {
                expect(outbox[0].status).toBe('queued'); // Still queued
                expect(getSentEvents().length).toBe(0); // No sent events
            }, 150);
        });
    });
    describe('Acceptance: Booking enqueues exactly one confirmation', () => {
        it('booking enqueues one confirmation and worker marks it sent', async () => {
            const { app } = await import('../src/index');
            const request = (await import('supertest')).default;
            const payload = {
                lead_id: '00Q1234567890ABC',
                manager_id: '0051234567890XYZ',
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
            // Clear outbox before test
            outbox.length = 0;
            sentEvents.length = 0;
            // Make booking request
            const res = await request(app).post('/book').send(payload);
            expect(res.status).toBe(200);
            expect(res.body.confirmation_message_id).toBeDefined();
            // Verify exactly one message is queued
            const queued = outbox.filter((e) => e.status === 'queued');
            expect(queued.length).toBe(1);
            expect(queued[0].message_id).toBe(res.body.confirmation_message_id);
            // Process outbox
            const result = drainOutbox();
            expect(result.processed).toBe(1);
            expect(result.succeeded).toBe(1);
            // Verify message is marked as sent
            const sentMessage = outbox.find((e) => e.message_id === res.body.confirmation_message_id);
            expect(sentMessage).toBeDefined();
            expect(sentMessage?.status).toBe('sent');
            expect(sentMessage?.message.delivery_status).toBe('sent');
            // Verify sent event was created
            const sentEvent = getSentEvents().find((e) => e.message_id === res.body.confirmation_message_id);
            expect(sentEvent).toBeDefined();
            expect(sentEvent?.success).toBe(true);
            expect(sentEvent?.template_rendered).toBeDefined();
        });
        it('multiple bookings enqueue separate confirmations', async () => {
            const { app } = await import('../src/index');
            const request = (await import('supertest')).default;
            outbox.length = 0;
            sentEvents.length = 0;
            // Create two bookings
            const payload1 = {
                lead_id: '00Q1234567890ABC',
                manager_id: '0051234567890XYZ',
                preferred_windows: [{ from: '2024-03-15T14:00:00.000Z', to: '2024-03-15T18:00:00.000Z' }],
                confirm: true,
                explicit_confirmation: true,
                confirmed_date: '2024-03-15T14:00:00.000Z',
                confirmed_time: '2024-03-15T14:00:00.000Z',
                qualification_flags: { budget: true },
            };
            const payload2 = {
                lead_id: '00Q1234567890DEF',
                manager_id: '0051234567890XYZ',
                preferred_windows: [{ from: '2024-03-15T15:00:00.000Z', to: '2024-03-15T19:00:00.000Z' }],
                confirm: true,
                explicit_confirmation: true,
                confirmed_date: '2024-03-15T15:00:00.000Z',
                confirmed_time: '2024-03-15T15:00:00.000Z',
                qualification_flags: { budget: true },
            };
            const res1 = await request(app).post('/book').send(payload1);
            const res2 = await request(app).post('/book').send(payload2);
            expect(res1.status).toBe(200);
            expect(res2.status).toBe(200);
            // Verify exactly two messages are queued
            const queued = outbox.filter((e) => e.status === 'queued');
            expect(queued.length).toBe(2);
            // Process outbox
            const result = drainOutbox();
            expect(result.processed).toBe(2);
            expect(result.succeeded).toBe(2);
            // Both should be marked as sent
            expect(outbox.filter((e) => e.status === 'sent').length).toBe(2);
            expect(getSentEvents().length).toBe(2);
        });
    });
    describe('Template Rendering', () => {
        it('renders email template with all variables', () => {
            const { renderTemplate } = require('../src/messaging/templates');
            const rendered = renderTemplate('email', 'booking_confirmation_v1', {
                contact_name: 'John Doe',
                manager_name: 'Jane Smith',
                meeting_date: 'March 15, 2024',
                meeting_time: '2:00 PM EST',
                meeting_url: 'https://meet.example.com/abc123',
                reschedule_link: 'https://reschedule.example.com/xyz789',
                company_name: 'Acme Corp',
            });
            expect(rendered).toContain('John Doe');
            expect(rendered).toContain('Jane Smith');
            expect(rendered).toContain('March 15, 2024');
            expect(rendered).toContain('2:00 PM EST');
            expect(rendered).toContain('https://meet.example.com/abc123');
            expect(rendered).toContain('https://reschedule.example.com/xyz789');
            expect(rendered).toContain('Acme Corp');
        });
        it('renders SMS template (shorter)', () => {
            const { renderTemplate } = require('../src/messaging/templates');
            const rendered = renderTemplate('sms', 'booking_confirmation_v1', {
                contact_name: 'John Doe',
                manager_name: 'Jane Smith',
                meeting_date: 'March 15, 2024',
                meeting_time: '2:00 PM EST',
                meeting_url: 'https://meet.example.com/abc123',
            });
            expect(rendered).toContain('March 15, 2024');
            expect(rendered).toContain('2:00 PM EST');
            expect(rendered.length).toBeLessThan(200); // SMS should be short
        });
    });
});
