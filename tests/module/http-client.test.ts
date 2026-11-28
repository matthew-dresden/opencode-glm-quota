import { describe, test, mock } from 'node:test';
import * as assert from 'node:assert';
import * as https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRequest } from '../../src/api/client.js';

// House rule (opencode-estate SPEC C3): test crypto material is generated at
// runtime and never stored in the repository.
function generateTestCert(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'https-test-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-subj', '/CN=localhost',
      ],
      { stdio: 'ignore' }
    );
    return {
      key: readFileSync(keyPath, 'utf-8'),
      cert: readFileSync(certPath, 'utf-8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('makeRequest', () => {
  test('sends auth header and parses JSON response', async () => {
    const authToken = 'test-token';
    const url = 'https://api.z.ai/api/monitor/usage/quota/limit';
    const responseBody = { limits: [] };
    
    const { key, cert } = generateTestCert();

    // Start a local HTTPS server with self-signed cert
    const server = https.createServer({ key, cert }, (req, res) => {
      // Assert auth header is present
      assert.ok(req.headers.authorization, 'Should have Authorization header');
      assert.strictEqual(req.headers.authorization, authToken, 'Auth header should match token');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });

    let serverPort = 0; // Initialize to 0 to avoid "used before assigned" error
    await new Promise<void>((resolve) => {
      server.listen(0, 'localhost', () => {
        const address = server.address() as { port: number };
        if (address) {
          serverPort = address.port;
        }
        resolve();
      });
    });

    // Wait for server to be fully ready (increased from 50ms to avoid ECONNREFUSED)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Temporarily trust the test certificate for this process
    const originalCa = https.globalAgent.options.ca;
    https.globalAgent.options.ca = cert;

    try {
      const result = await makeRequest({
        url: `https://localhost:${serverPort}/api/monitor/usage/quota/limit`,
        authToken
      });

      assert.deepStrictEqual(result, responseBody);
    } finally {
      https.globalAgent.options.ca = originalCa;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
