import { ChallengeStorage } from './challenge';
import { TunnelStorage } from './tunnel-storage';
import { importPublicKey, verifySignature, generateJWT } from './auth';
import {
  generateChallenge,
  generateToken,
  corsHeaders,
  jsonResponse,
  errorResponse,
  getAuthorizedClients,
  extractSecrets,
} from './utils';

export { ChallengeStorage, TunnelStorage };

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
          includeRepoList?: boolean;
          tunnelUrl?: string;
        }>();
        const { clientId, challenge, signature, repoUrl, grpcEndpoint, includeRepoList, tunnelUrl } = body;

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
        const secretDataKey = 'SECRET_DATA' as keyof Env;
        const jwtSecret = typeof env[secretDataKey] === 'string' ? env[secretDataKey] : 'default-secret';
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
                headers: {
                  'Content-Type': 'application/json',
                  'X-Service-Binding': 'true',
                },
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

        // ランダムなトークンを生成
        const accessToken = generateToken();

        // Tunnel URL登録（オプション）
        if (tunnelUrl) {
          try {
            const tunnelId = env.TUNNEL_STORAGE.idFromName('global');
            const tunnelStub = env.TUNNEL_STORAGE.get(tunnelId);
            const tunnelResponse = await tunnelStub.fetch('http://internal/store', {
              method: 'POST',
              body: JSON.stringify({ clientId, tunnelUrl, token: accessToken }),
            });

            if (tunnelResponse.ok) {
              console.log(`Tunnel URL registered for client: ${clientId}`);
            } else {
              console.error(`Failed to store tunnel URL for client: ${clientId}`);
            }
          } catch (error) {
            console.error(`Error storing tunnel URL:`, error);
          }
        }

        // repoUrlリストを取得（オプション）
        let repoList: string[] | undefined;
        if (includeRepoList) {
          try {
            const repoListResponse = await env.WEBHOOK_WORKER.fetch('http://internal/repos', {
              method: 'GET',
              headers: {
                'X-Service-Binding': 'true',
              },
            });

            if (repoListResponse.ok) {
              const responseData = await repoListResponse.json<{
                success: boolean;
                data: Array<{ repo: string }>;
                count: number;
              }>();

              if (responseData.success && responseData.data) {
                repoList = responseData.data.map((item) => item.repo);
                console.log(`Retrieved ${repoList.length} repos from webhook worker`);
              }
            } else {
              console.error(`Failed to retrieve repo list: ${repoListResponse.status}`);
            }
          } catch (error) {
            console.error(`Error retrieving repo list:`, error);
          }
        }

        console.log(`Authentication successful for client: ${clientId}`);
        return jsonResponse({
          success: true,
          token,
          accessToken,
          secretData,
          ...(repoList && { repoList }),
        });
      }

      // POST /tunnel/register - Tunnel URL登録（Go Backendから呼ばれる）
      if (path === '/tunnel/register' && request.method === 'POST') {
        const body = await request.json<{
          clientId?: string;
          tunnelUrl?: string;
          token?: string;
        }>();
        const { clientId, tunnelUrl, token } = body;

        if (!clientId || !tunnelUrl || !token) {
          console.error('Missing fields in /tunnel/register request');
          return errorResponse('Bad request', 400);
        }

        // Durable ObjectからトンネルURLと保存済みトークンを取得して検証
        const id = env.TUNNEL_STORAGE.idFromName('global');
        const stub = env.TUNNEL_STORAGE.get(id);
        const getResponse = await stub.fetch(`http://internal/get/${clientId}`);

        if (!getResponse.ok) {
          console.error(`No existing tunnel found for client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        const existingData = await getResponse.json<{
          success: boolean;
          data: { token: string };
        }>();

        // トークン検証
        if (!existingData.success || existingData.data.token !== token) {
          console.error(`Invalid token for client: ${clientId}`);
          return errorResponse('Authentication failed', 401);
        }

        // トンネル情報を更新
        const updateResponse = await stub.fetch('http://internal/store', {
          method: 'POST',
          body: JSON.stringify({ clientId, tunnelUrl, token }),
        });

        if (!updateResponse.ok) {
          console.error('Failed to update tunnel URL');
          return errorResponse('Failed to register tunnel', 500);
        }

        const result = await updateResponse.json();
        console.log(`Tunnel URL updated for client: ${clientId}`);
        return jsonResponse(result);
      }

      // GET /tunnel/{clientId} - Tunnel URL取得（Service Bindingから呼ばれる）
      if (path.startsWith('/tunnel/') && request.method === 'GET') {
        const clientId = path.substring(8);

        if (!clientId) {
          return errorResponse('Bad request', 400);
        }

        // Service Bindingからのリクエストかチェック
        const isServiceBindingRequest =
          request.headers.get('X-Service-Binding') === 'true' ||
          new URL(request.url).hostname === 'fake-host' ||
          new URL(request.url).hostname.endsWith('.internal');

        if (!isServiceBindingRequest) {
          console.error('Unauthorized access to /tunnel/{clientId}');
          return errorResponse('Unauthorized', 401);
        }

        // Durable Objectからトンネル情報を取得
        const id = env.TUNNEL_STORAGE.idFromName('global');
        const stub = env.TUNNEL_STORAGE.get(id);
        const response = await stub.fetch(`http://internal/get/${clientId}`);

        if (!response.ok) {
          console.error(`Tunnel not found for client: ${clientId}`);
          return errorResponse('Tunnel not found', 404);
        }

        const result = await response.json();
        return jsonResponse(result);
      }

      // GET /tunnels - 全Tunnel URL取得
      // Service Bindingまたは認証済みクライアント用
      if (path === '/tunnels' && request.method === 'GET') {
        // Service Bindingからのリクエストかチェック
        const isServiceBindingRequest =
          request.headers.get('X-Service-Binding') === 'true' ||
          new URL(request.url).hostname === 'fake-host' ||
          new URL(request.url).hostname.endsWith('.internal');

        // Service Bindingでない場合は認証が必要（将来実装）
        if (!isServiceBindingRequest) {
          // TODO: JWT認証を追加
          console.log('Public request to /tunnels - requires authentication');
        }

        const id = env.TUNNEL_STORAGE.idFromName('global');
        const stub = env.TUNNEL_STORAGE.get(id);
        const response = await stub.fetch('http://internal/list');

        if (!response.ok) {
          console.error('Failed to list tunnels');
          return errorResponse('Failed to list tunnels', 500);
        }

        const result = await response.json();
        return jsonResponse(result);
      }

      return errorResponse('Not found', 404);
    } catch (error) {
      console.error('Internal error:', error);
      return errorResponse('Internal error', 500);
    }
  },
};
