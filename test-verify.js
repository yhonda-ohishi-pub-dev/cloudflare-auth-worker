/**
 * Test script for /verify endpoint with includeRepoList option
 *
 * This script:
 * 1. Requests a challenge
 * 2. Signs the challenge with a private key
 * 3. Verifies with includeRepoList: true
 * 4. Displays the response including repo list
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKER_URL = 'https://cloudflare-auth-worker.m-tama-ramu.workers.dev';
const CLIENT_ID = 'testclient';

// Load private key from file
const PRIVATE_KEY_PEM = fs.readFileSync(
  path.join(__dirname, 'test-private.pem'),
  'utf8'
);

async function testVerifyWithRepoList() {
  try {
    console.log('Step 1: Requesting challenge...');
    const challengeResponse = await fetch(`${WORKER_URL}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID })
    });

    if (!challengeResponse.ok) {
      throw new Error(`Challenge failed: ${challengeResponse.status} ${await challengeResponse.text()}`);
    }

    const { challenge, expiresAt } = await challengeResponse.json();
    console.log(`✓ Challenge received: ${challenge}`);
    console.log(`  Expires at: ${new Date(expiresAt).toISOString()}`);

    console.log('\nStep 2: Signing challenge...');
    const sign = crypto.createSign('SHA256');
    sign.update(challenge);
    sign.end();
    const signature = sign.sign(PRIVATE_KEY_PEM, 'base64');
    console.log(`✓ Signature created: ${signature.substring(0, 50)}...`);

    console.log('\nStep 3: Verifying with includeRepoList: true...');
    const verifyResponse = await fetch(`${WORKER_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        challenge: challenge,
        signature: signature,
        includeRepoList: true
      })
    });

    if (!verifyResponse.ok) {
      throw new Error(`Verify failed: ${verifyResponse.status} ${await verifyResponse.text()}`);
    }

    const result = await verifyResponse.json();
    console.log('\n✓ Verification successful!');
    console.log('\nResponse:');
    console.log(JSON.stringify(result, null, 2));

    if (result.repoList) {
      console.log(`\n✓ Repository list retrieved: ${result.repoList.length} repositories`);
      result.repoList.forEach((repo, index) => {
        console.log(`  ${index + 1}. ${repo}`);
      });
    } else {
      console.log('\n⚠ No repository list in response');
    }

  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
  }
}

testVerifyWithRepoList();
