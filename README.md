# Cloudflare Worker 公開鍵認証システム

RSA公開鍵認証を使用してCloudflare Workerに安全に接続し、Secret変数を取得するシステム。

## 機能

- 🔐 RSA公開鍵認証によるクライアント認証
- 🔑 チャレンジ-レスポンス認証方式
- 💾 Durable Objectsによるチャレンジ管理
- 🎫 JWT トークン生成
- 🛡️ セキュアなエラーハンドリング（抽象的なエラーメッセージ、詳細はログに記録）

## API エンドポイント

### GET /health
ヘルスチェック

**レスポンス:**
```json
{
  "status": "ok"
}
```

### POST /challenge
チャレンジを生成

**リクエスト:**
```json
{
  "clientId": "クライアント識別子"
}
```

**レスポンス:**
```json
{
  "challenge": "ランダムなチャレンジ（Base64）",
  "expiresAt": 1234567890
}
```

### POST /verify
署名を検証してSecret変数を返す

**リクエスト:**
```json
{
  "clientId": "クライアント識別子",
  "challenge": "受け取ったチャレンジ",
  "signature": "秘密鍵で署名したチャレンジ（Base64）"
}
```

**レスポンス（成功）:**
```json
{
  "success": true,
  "token": "JWTトークン",
  "secretData": {
    "SECRET_DATA": "機密情報",
    "API_KEY": "APIキー"
  }
}
```

## セットアップ

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 型定義の生成
```bash
npx wrangler types
```

### 3. 環境変数の設定

`wrangler.toml` で公開鍵を設定:
```toml
[vars]
AUTHORIZED_CLIENTS = '{"clientId":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}'
SECRET_DATA = "your-secret-data"
API_KEY = "your-api-key"
```

### 4. ローカル開発
```bash
npm run dev
```

### 5. デプロイ
```bash
npm run deploy
```

## クライアント実装

### 鍵ペアの生成
```bash
# 秘密鍵生成
openssl genrsa -out private.pem 2048

# 公開鍵抽出
openssl rsa -in private.pem -pubout -out public.pem
```

### 認証フロー

1. **チャレンジ取得**
```javascript
const response = await fetch('https://your-worker.workers.dev/challenge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: 'your-client-id' })
});
const { challenge } = await response.json();
```

2. **チャレンジに署名**
```javascript
const crypto = require('crypto');
const fs = require('fs');

const privateKey = fs.readFileSync('private.pem', 'utf8');
const sign = crypto.createSign('SHA256');
sign.update(challenge);
sign.end();
const signature = sign.sign(privateKey, 'base64');
```

3. **署名を検証**
```javascript
const response = await fetch('https://your-worker.workers.dev/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: 'your-client-id', challenge, signature })
});
const result = await response.json();
console.log(result.secretData);
```

## プロジェクト構造

```
├── src/
│   ├── index.ts          # Workerエントリーポイント
│   ├── challenge.ts      # Durable Objects（チャレンジ管理）
│   ├── auth.ts           # RSA署名検証・JWT生成
│   └── utils.ts          # ユーティリティ関数
├── test/                 # テストファイル（未実装）
├── wrangler.toml         # Worker設定
├── tsconfig.json         # TypeScript設定
├── SPEC.md               # 詳細仕様書
└── claude.md             # プロジェクトガイド

```

## セキュリティ要件

- **公開鍵暗号**: RSA 2048ビット以上
- **署名方式**: RSASSA-PKCS1-v1_5
- **ハッシュ**: SHA-256
- **チャレンジ**: 32バイトのランダムデータ、5分間有効
- **エラーレスポンス**: セキュリティのため抽象的（詳細はログに記録）

## 技術スタック

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **State Management**: Durable Objects
- **Authentication**: RSA + JWT
- **API**: Web Crypto API

## ドキュメント

- [SPEC.md](SPEC.md) - 詳細な仕様書
- [claude.md](claude.md) - プロジェクトガイド

## ライセンス

MIT

## 開発

プロジェクトは Claude Code を使用して生成されました。
