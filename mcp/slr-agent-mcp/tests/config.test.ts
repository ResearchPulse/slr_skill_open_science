import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('MCP configuration', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(loadConfig({
      SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
      SLR_AGENT_TOKEN: 'token',
    }).apiBaseUrl).toBe('https://slr-api.hyperdatalab.org/api');

    expect(loadConfig({
      SLR_API_BASE_URL: 'http://127.0.0.1:3000/api/',
      SLR_AGENT_TOKEN: 'token',
    }).apiBaseUrl).toBe('http://127.0.0.1:3000/api');

    expect(loadConfig({
      SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
      SLR_AGENT_TOKEN: 'token',
      SLR_PROFILE_ID: 'profile-1',
      SLR_PROJECT_ID: 'project-1',
    }).profileId).toBe('profile-1');
  });

  it('rejects remote HTTP endpoints', () => {
    expect(() => loadConfig({
      SLR_API_BASE_URL: 'http://slr-api.hyperdatalab.org/api',
      SLR_AGENT_TOKEN: 'token',
    })).toThrow('HTTPS');
  });

  it('rejects URL credentials, queries, and fragments', () => {
    for (const url of [
      'https://user:pass@slr-api.hyperdatalab.org/api',
      'https://slr-api.hyperdatalab.org/api?redirect=http://evil.test',
      'https://slr-api.hyperdatalab.org/api#fragment',
    ]) {
      expect(() => loadConfig({ SLR_API_BASE_URL: url, SLR_AGENT_TOKEN: 'token' })).toThrow();
    }
  });

  it('keeps an explicit API host allowlist within approved hosts', () => {
    expect(loadConfig({
      SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
      SLR_API_ALLOWED_HOSTS: 'slr-api.hyperdatalab.org,127.0.0.1',
      SLR_AGENT_TOKEN: 'token',
    }).allowedHosts).toEqual(['slr-api.hyperdatalab.org', '127.0.0.1']);
    expect(() => loadConfig({
      SLR_API_BASE_URL: 'https://unexpected.example.test/api',
      SLR_API_ALLOWED_HOSTS: 'slr-api.hyperdatalab.org',
      SLR_AGENT_TOKEN: 'token',
    })).toThrow('approved SLR API allowlist');
    expect(() => loadConfig({
      SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
      SLR_API_ALLOWED_HOSTS: 'unexpected.example.test',
      SLR_AGENT_TOKEN: 'token',
    })).toThrow('unapproved host');
  });

  it('validates response size overrides', () => {
    expect(loadConfig({
      SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
      SLR_AGENT_TOKEN: 'token',
      SLR_MAX_JSON_RESPONSE_BYTES: '16384',
      SLR_MAX_MARKDOWN_RESPONSE_BYTES: '32768',
    })).toMatchObject({ maxJsonResponseBytes: 16384, maxMarkdownResponseBytes: 32768 });
    expect(() => loadConfig({
      SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
      SLR_AGENT_TOKEN: 'token',
      SLR_MAX_JSON_RESPONSE_BYTES: '1',
    })).toThrow('SLR_MAX_JSON_RESPONSE_BYTES');
  });

  it('requires a token without echoing its value', () => {
    expect(() => loadConfig({ SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api' })).toThrow('SLR_AGENT_TOKEN');
  });
});
