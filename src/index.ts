import { ChallengeStorage } from './challenge';
import { importPublicKey, verifySignature, generateJWT } from './auth';
import {
  generateChallenge,
  corsHeaders,
  jsonResponse,
  errorResponse,
  getAuthorizedClients,
  extractSecrets,
} from './utils';

export { ChallengeStorage };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // GET /health - ヘルスチェック
      if (path === '/health' && request.method === 'GET') {
        return jsonResponse({ status: 'ok' });
      }

      // POST /challenge - チャレンジ生成
      if (path === '/challenge' && request.method === 'POST') {
        const body = await request.json<{ clientId?: string }>();
        const { clientId } = body;

        if (!clientId) {
          console.error('Missing clientId in /challenge request');
          return errorResponse('Bad request', 400);
        }

        // 承認されたクライアントか確認
        const authorizedClients = getAuthorizedClients(env.AUTHORIZED_CLIENTS);
        const publicKey = authorizedClients[clientId];

        if (!publicKey) {
          console.error(`Unauthorized client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        // チャレンジ生成
        const challenge = generateChallenge();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5分後

        // Durable Objectに保存
        const id = env.CHALLENGE_STORAGE.idFromName(clientId);
        const stub = env.CHALLENGE_STORAGE.get(id);
        await stub.fetch('http://internal/store', {
          method: 'POST',
          body: JSON.stringify({ clientId, challenge, expiresAt }),
        });

        console.log(`Challenge generated for client: ${clientId}`);
        return jsonResponse({ challenge, expiresAt });
      }

      // POST /verify - 署名検証
      if (path === '/verify' && request.method === 'POST') {
        const body = await request.json<{
          clientId?: string;
          challenge?: string;
          signature?: string;
          repoUrl?: string;
          grpcEndpoint?: string;
        }>();
        const { clientId, challenge, signature, repoUrl, grpcEndpoint } = body;

        if (!clientId || !challenge || !signature) {
          console.error('Missing fields in /verify request');
          return errorResponse('Bad request', 400);
        }

        // Durable Objectからチャレンジを取得
        const id = env.CHALLENGE_STORAGE.idFromName(clientId);
        const stub = env.CHALLENGE_STORAGE.get(id);
        const response = await stub.fetch(`http://internal/get/${clientId}`);

        if (!response.ok) {
          console.error(`Challenge not found for client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        const storedData = await response.json<{ challenge: string; expiresAt: number }>();

        // チャレンジの期限確認
        if (Date.now() > storedData.expiresAt) {
          console.error(`Challenge expired for client: ${clientId}`);
          // 期限切れのチャレンジを削除
          await stub.fetch(`http://internal/delete/${clientId}`, { method: 'DELETE' });
          return errorResponse('Authentication failed', 401);
        }

        // チャレンジの一致確認
        if (storedData.challenge !== challenge) {
          console.error(`Challenge mismatch for client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        // 公開鍵を取得
        const authorizedClients = getAuthorizedClients(env.AUTHORIZED_CLIENTS);
        const publicKeyPem = authorizedClients[clientId];

        if (!publicKeyPem) {
          console.error(`Public key not found for client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        // 署名検証
        const publicKey = await importPublicKey(publicKeyPem);
        const isValid = await verifySignature(publicKey, challenge, signature);

        if (!isValid) {
          console.error(`Invalid signature for client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        // チャレンジを削除（使い捨て）
        await stub.fetch(`http://internal/delete/${clientId}`, { method: 'DELETE' });

        // JWT生成（SECRET_DATAがあればそれを使用、なければデフォルト）
        const jwtSecret = env.SECRET_DATA || 'default-secret';
        const token = await generateJWT(clientId, jwtSecret);

        // 環境変数から全てのsecretを動的に抽出
        const secretData = extractSecrets(env);

        // GitHub Webhook Workerにrepo情報を更新（repo情報が提供されている場合）
        if (repoUrl && grpcEndpoint) {
          try {
            const webhookPayload = { grpcEndpoint };

            const webhookResponse = await env.WEBHOOK_WORKER.fetch(
              `http://internal/repo/${encodeURIComponent(repoUrl)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookPayload),
              }
            );

            if (!webhookResponse.ok) {
              const errorText = await webhookResponse.text();
              console.error(
                `Failed to update webhook worker for repo ${repoUrl}: ${webhookResponse.status} ${errorText}`
              );
            } else {
              console.log(`Successfully updated webhook worker for repo: ${repoUrl}`);
            }
          } catch (error) {
            console.error(`Error calling webhook worker:`, error);
          }
        }

        console.log(`Authentication successful for client: ${clientId}`);
        return jsonResponse({
          success: true,
          token,
          secretData,
        });
      }

      return errorResponse('Not found', 404);
    } catch (error) {
      console.error('Internal error:', error);
      return errorResponse('Internal error', 500);
    }
  },
};
