import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { upsertTask, getTask, taskStore, type TaskPayload } from '../src/crm/salesforceMock';

describe('CRM Salesforce Mock', () => {
  const baseTaskPayload: TaskPayload = {
    booking_id: '550e8400-e29b-41d4-a716-446655440000',
    lead_id: '00Q1234567890ABC',
    contact_id: null,
    manager_id: '0051234567890XYZ',
    outcome: 'booked',
    qualification_flags: {
      budget: true,
      authority: true,
      need: 'high',
      timeline: 'this_quarter',
    },
    notes: 'Meeting scheduled for Tuesday at 2 PM',
    call_id: '660e8400-e29b-41d4-a716-446655440001',
    meeting_id: '770e8400-e29b-41d4-a716-446655440002',
    created_ts: '2024-03-15T19:00:00.000Z',
    consent_status: 'granted',
  };

  beforeEach(() => {
    // Clear store before each test
    taskStore.clear();
  });

  describe('upsertTask', () => {
    it('creates a new task successfully', () => {
      const result = upsertTask(baseTaskPayload);

      expect(result.success).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task?.External_Id__c).toBe(baseTaskPayload.booking_id);
      expect(result.task?.WhoId).toBe(baseTaskPayload.lead_id);
      expect(result.task?.OwnerId).toBe(baseTaskPayload.manager_id);
      expect(result.task?.CallDisposition__c).toBe('booked');

      const stored = getTask(baseTaskPayload.booking_id);
      expect(stored).toBeDefined();
      expect(stored?.External_Id__c).toBe(baseTaskPayload.booking_id);
    });

    it('updates existing task when booking_id already exists', () => {
      // Create initial task
      const result1 = upsertTask(baseTaskPayload);
      expect(result1.success).toBe(true);

      const initialTask = getTask(baseTaskPayload.booking_id);
      expect(initialTask).toBeDefined();
      expect(initialTask?.Subject).toContain('booked');

      // Update with same booking_id but different data
      const updatedPayload: TaskPayload = {
        ...baseTaskPayload,
        outcome: 'reschedule_requested',
        notes: 'Prospect requested to reschedule',
        meeting_id: null,
      };

      const result2 = upsertTask(updatedPayload);
      expect(result2.success).toBe(true);
      expect(result2.task).toBeDefined();

      const updatedTask = getTask(baseTaskPayload.booking_id);
      expect(updatedTask).toBeDefined();
      expect(updatedTask?.CallDisposition__c).toBe('reschedule_requested');
      expect(updatedTask?.Description).toBe('Prospect requested to reschedule');

      // Verify only one record exists
      expect(taskStore.size).toBe(1);
    });

    it('rejects invalid booking payload', () => {
      const invalidPayload: TaskPayload = {
        ...baseTaskPayload,
        outcome: 'invalid_outcome', // Invalid enum value
      };

      const result = upsertTask(invalidPayload);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Validation failed');
    });

    it('rejects missing booking_id', () => {
      const invalidPayload = {
        ...baseTaskPayload,
        booking_id: '', // Empty booking_id
      };

      const result = upsertTask(invalidPayload);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Acceptance: Duplicate writes', () => {
    it('posting the same booking_id twice results in one stored record and 200', async () => {
      const payload = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        lead_id: '00Q1234567890ABC',
        manager_id: '0051234567890XYZ',
        outcome: 'booked',
        qualification_flags: {
          budget: true,
          authority: true,
        },
        call_id: '660e8400-e29b-41d4-a716-446655440001',
        created_ts: '2024-03-15T19:00:00.000Z',
      };

      // First POST
      const res1 = await request(app).post('/bookings').send(payload);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.booking_id).toBe(payload.booking_id);
      expect(res1.body.task).toBeDefined();
      expect(taskStore.size).toBe(1);

      // Second POST with same booking_id
      const res2 = await request(app).post('/bookings').send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.booking_id).toBe(payload.booking_id);
      expect(res2.body.task).toBeDefined();

      // Verify only one record exists
      expect(taskStore.size).toBe(1);

      const stored = getTask(payload.booking_id);
      expect(stored).toBeDefined();
      expect(stored?.External_Id__c).toBe(payload.booking_id);
    });

    it('updates existing record when posting same booking_id with different data', async () => {
      const payload1 = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        lead_id: '00Q1234567890ABC',
        manager_id: '0051234567890XYZ',
        outcome: 'booked',
        qualification_flags: { budget: true },
        call_id: '660e8400-e29b-41d4-a716-446655440001',
        created_ts: '2024-03-15T19:00:00.000Z',
      };

      // First POST
      const res1 = await request(app).post('/bookings').send(payload1);
      expect(res1.status).toBe(200);
      expect(res1.body.task.CallDisposition__c).toBe('booked');

      // Second POST with same booking_id but different outcome
      const payload2 = {
        ...payload1,
        outcome: 'reschedule_requested',
        notes: 'Updated notes',
      };

      const res2 = await request(app).post('/bookings').send(payload2);
      expect(res2.status).toBe(200);
      expect(res2.body.task.CallDisposition__c).toBe('reschedule_requested');
      expect(res2.body.task.Description).toBe('Updated notes');

      // Verify only one record
      expect(taskStore.size).toBe(1);
    });
  });

  describe('POST /crm/tasks', () => {
    it('creates a task via API', async () => {
      const payload: TaskPayload = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        lead_id: '00Q1234567890ABC',
        manager_id: '0051234567890XYZ',
        outcome: 'booked',
        qualification_flags: { budget: true, authority: true },
        call_id: '660e8400-e29b-41d4-a716-446655440001',
        created_ts: '2024-03-15T19:00:00.000Z',
      };

      const res = await request(app).post('/crm/tasks').send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.task).toBeDefined();
      expect(res.body.task.External_Id__c).toBe(payload.booking_id);
    });

    it('updates existing task when same booking_id is posted', async () => {
      const payload: TaskPayload = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        lead_id: '00Q1234567890ABC',
        manager_id: '0051234567890XYZ',
        outcome: 'booked',
        qualification_flags: { budget: true },
        call_id: '660e8400-e29b-41d4-a716-446655440001',
        created_ts: '2024-03-15T19:00:00.000Z',
      };

      // First POST
      const res1 = await request(app).post('/crm/tasks').send(payload);
      expect(res1.status).toBe(200);

      // Second POST with same booking_id
      const res2 = await request(app).post('/crm/tasks').send(payload);
      expect(res2.status).toBe(200);

      // Verify only one record
      expect(taskStore.size).toBe(1);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app).post('/crm/tasks').send({
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        // Missing other required fields
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /bookings', () => {
    it('creates a booking and writes to CRM', async () => {
      const payload = {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        lead_id: '00Q1234567890ABC',
        manager_id: '0051234567890XYZ',
        outcome: 'booked',
        qualification_flags: {
          budget: true,
          authority: true,
          need: 'high',
        },
        call_id: '660e8400-e29b-41d4-a716-446655440001',
        created_ts: '2024-03-15T19:00:00.000Z',
        meeting_id: '770e8400-e29b-41d4-a716-446655440002',
      };

      const res = await request(app).post('/bookings').send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.booking_id).toBe(payload.booking_id);
      expect(res.body.task).toBeDefined();
      expect(res.body.task.Meeting_ID__c).toBe(payload.meeting_id);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app).post('/bookings').send({
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        // Missing other required fields
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });
});

