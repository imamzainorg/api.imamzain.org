import type { Scenario } from '../scenario';

const BASE = '/api/v1/youtube';
const get = (path: string) => ({ method: 'GET' as const, path, auth: 'anon' as const });

// Read-only: pagination bounds and playlist limits beyond what the sampled corpus covers.
export default [
  {
    name: 'bounds',
    steps: [
      get(`${BASE}/videos?page=2&limit=100`),
      get(`${BASE}/videos?page=9999`),
      get(`${BASE}/videos?limit=0`),
      get(`${BASE}/videos?limit=101`),
      get(`${BASE}/videos?page=abc`),
      get(`${BASE}/playlists?page=2&limit=7`),
      get(`${BASE}/playlists?limit=0.5`),
      get(`${BASE}/playlists/does-not-exist/videos`),
      get(`${BASE}/playlists/does-not-exist/videos?limit=500`),
    ],
  },
] satisfies Scenario[];
