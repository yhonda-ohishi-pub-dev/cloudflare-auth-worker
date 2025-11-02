// ユーティリティ関数

/**
 * ランダムなチャレンジ（32バイト）を生成
 */
export function generateChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * ランダムなトークン（32バイト）を生成
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * CORS ヘッダーを追加
 */
export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * JSON レスポンスを生成（CORS対応）
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

/**
 * エラーレスポンスを生成
 */
export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ success: false, error: message }, status);
}

/**
 * 承認されたクライアントの公開鍵を取得
 */
export function getAuthorizedClients(envVar: string): Record<string, string> {
  try {
    return JSON.parse(envVar);
  } catch (error) {
    console.error('Failed to parse AUTHORIZED_CLIENTS:', error);
    return {};
  }
}

/**
 * 環境変数からsecretデータを抽出
 * AUTHORIZED_CLIENTSとCHALLENGE_STORAGE以外の全ての変数を返す
 */
export function extractSecrets(env: Env): Record<string, string> {
  const secrets: Record<string, string> = {};
  const excludeKeys = ['AUTHORIZED_CLIENTS', 'CHALLENGE_STORAGE'];

  // Envの各キーを取得して処理
  Object.keys(env).forEach((key) => {
    const value = env[key as keyof Env];
    if (!excludeKeys.includes(key) && typeof value === 'string') {
      secrets[key] = value;
    }
  });

  return secrets;
}
