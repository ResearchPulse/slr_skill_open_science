import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('MCP configuration', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(loadConfig({
      SLR_API_BASE_URL: 'https://slr.example.test/api',
      SLR_AGENT_TOKEN: 'token',
    }).apiBaseUrl).toBe('https://slr.example.test/api');

    expect(loadConfig({
      SLR_API_BASE_URL: 'http://127.0.0.1:3000/api/',
      SLR_AGENT_TOKEN: 'token',
    }).apiBaseUrl).toBe('http://127.0.0.1:3000/api');
  });

  it('rejects remote HTTP endpoints', () => {
    expect(() => loadConfig({
      SLR_API_BASE_URL: 'http://slr.example.test/api',
      SLR_AGENT_TOKEN: 'token',
    })).toThrow('HTTPS');
  });

  it('requires a token without echoing its value', () => {
    expect(() => loadConfig({ SLR_API_BASE_URL: 'https://slr.example.test/api' })).toThrow('SLR_AGENT_TOKEN');
  });
});
