import { describe, test, mock } from 'node:test';
import * as assert from 'node:assert';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRequest } from '../../src/api/client.js';

describe('makeRequest', () => {
  test('sends auth header and parses JSON response', async () => {
    const authToken = 'test-token';
    const url = 'https://api.z.ai/api/monitor/usage/quota/limit';
    const responseBody = { limits: [] };
    
    // Generate TLS material at runtime (house rule: no secret-shaped material in the
    // repo — real credentials come from AWS SSM, test crypto is generated here).
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const tmpDir = mkdtempSync(join(tmpdir(), 'tls-test-'));
    const keyPath = join(tmpDir, 'k.pem');
    const certPath = join(tmpDir, 'c.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf-8');
    execFileSync('openssl', [
      'req', '-x509',
      '-key', keyPath,
      '-out', certPath,
      '-days', '1',
      '-subj', '/CN=localhost/O=Test',
    ], { stdio: 'pipe' });
    const key = readFileSync(keyPath, 'utf-8');
    const cert = readFileSync(certPath, 'utf-8');

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
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
