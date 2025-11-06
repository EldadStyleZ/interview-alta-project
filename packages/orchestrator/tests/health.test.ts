import request from 'supertest';
import { app } from '../src/index';

describe('GET /healthz', () => {
  it('returns 200 with service name and sha', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('service', 'orchestrator');
    expect(res.body).toHaveProperty('sha');
    expect(res.body).toHaveProperty('status', 'ok');
  });
});

