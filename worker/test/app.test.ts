import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('app', () => {
  it('answers 404 while no group is ported', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(404);
  });
});
