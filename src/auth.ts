// 認証ロジック: RSA署名検証

/**
 * PEM形式の公開鍵をCryptoKeyにインポート
 */
export async function importPublicKey(pemKey: string): Promise<CryptoKey> {
  // PEM形式からヘッダーとフッターを削除してBase64デコード
  const pemHeader = '-----BEGIN PUBLIC KEY-----';
  const pemFooter = '-----END PUBLIC KEY-----';
  const pemContents = pemKey
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\s/g, '');

  // Base64デコード
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // CryptoKeyとしてインポート
  return await crypto.subtle.importKey(
    'spki',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify']
  );
}

/**
 * RSA署名を検証
 */
export async function verifySignature(
  publicKey: CryptoKey,
  challenge: string,
  signature: string
): Promise<boolean> {
  try {
    // Base64デコード
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const challengeBytes = new TextEncoder().encode(challenge);

    // 署名検証
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      challengeBytes
    );

    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * JWTトークンを生成（簡易版）
 */
export async function generateJWT(clientId: string, secretKey: string): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload = {
    clientId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1時間有効
  };

  // Base64url エンコード
  const base64UrlEncode = (obj: object): string => {
    const json = JSON.stringify(obj);
    return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const data = `${encodedHeader}.${encodedPayload}`;

  // HMAC-SHA256で署名
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${data}.${encodedSignature}`;
}
