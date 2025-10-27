# Cloudflare Worker 公開鍵認証システム仕様書

## 概要
クライアントアプリケーションが公開鍵認証を使用してCloudflare Workerに接続し、Secret変数を安全に取得するシステム。

## システムフロー

### 1. 初期化フェーズ（アプリ起動時）
```
Client → Worker: POST /challenge
  Body: {
    "clientId": "unique-client-identifier"
  }

Worker: AUTHORIZED_CLIENTSから公開鍵を取得
Worker: 存在しない場合は401エラー

Worker → Client: 200 OK
  Body: {
    "challenge": "base64-encoded-random-bytes",
    "expiresAt": 1234567890
  }
```

### 2. 認証フェーズ
```
Client: チャレンジを秘密鍵で署名

Client → Worker: POST /verify
  Body: {
    "clientId": "unique-client-identifier",
    "challenge": "base64-encoded-random-bytes",
    "signature": "base64-encoded-signature"
  }

Worker: 公開鍵で署名を検証

Worker → Client: 200 OK (認証成功)
  Body: {
    "success": true,
    "token": "session-token",
    "secretData": {
      "SECRET_DATA": "機密情報",
      "API_KEY": "APIキー"
    }
  }

Worker → Client: 401 Unauthorized (認証失敗)
  Body: {
    "success": false,
    "error": "Invalid signature"
  }
```

## エンドポイント仕様

### POST /challenge
チャレンジを生成して返す

**リクエスト:**
```json
{
  "clientId": "クライアント識別子"
}
```

**レスポンス（成功）:**
```json
{
  "challenge": "ランダムに生成されたチャレンジ（Base64）",
  "expiresAt": 1234567890
}
```

**レスポンス（エラー）:**
- 400: `clientId`が欠けている
- 401: 承認されていないクライアント

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
  "token": "セッショントークン",
  "secretData": {
    "SECRET_DATA": "機密情報",
    "API_KEY": "APIキー"
  }
}
```

**レスポンス（エラー）:**
- 400: 必須フィールドが欠けている
- 401: チャレンジが見つからない、期限切れ、署名が無効

### GET /health
ヘルスチェック

**レスポンス:**
```json
{
  "status": "ok"
}
```

## セキュリティ要件

### 公開鍵暗号方式
- **アルゴリズム**: RSA
- **署名方式**: RSASSA-PKCS1-v1_5
- **ハッシュ**: SHA-256
- **鍵長**: 2048ビット以上推奨

### チャレンジ
- **サイズ**: 32バイト（256ビット）のランダムデータ
- **有効期限**: 5分
- **使い捨て**: 1回の認証で使用後は削除

### セッション管理
- チャレンジは一時的にメモリに保存（本番環境ではKV推奨）
- 認証成功後にトークンを発行（オプション）

## Cloudflare 環境変数とSecret変数

### 環境変数（wrangler.toml）
公開鍵は秘密情報ではないため、varsで管理:

```toml
[vars]
AUTHORIZED_CLIENTS = '{"client1":"-----BEGIN PUBLIC KEY-----\nMIIB...","client2":"-----BEGIN PUBLIC KEY-----\nMIIB..."}'
```

### Secret変数
機密情報は`wrangler secret put`コマンドで設定:

```bash
wrangler secret put SECRET_DATA
wrangler secret put API_KEY
```

## クライアント実装要件

### 鍵ペア生成
クライアントは事前にRSA鍵ペアを生成:
```bash
# 秘密鍵生成
openssl genrsa -out private.pem 2048

# 公開鍵抽出
openssl rsa -in private.pem -pubout -out public.pem
```

**管理者は公開鍵をWorkerに登録:**

wrangler.tomlに追加:
```toml
[vars]
AUTHORIZED_CLIENTS = '{"client1":"-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----"}'
```

### 認証フロー実装
1. アプリ起動時にclientIdを送信して`/challenge`を呼び出し
2. 受け取ったチャレンジを秘密鍵で署名
3. 署名を`/verify`エンドポイントに送信
4. 認証成功後、Secret変数を取得して使用

### 署名生成例（Node.js）
```javascript
const crypto = require('crypto');
const fs = require('fs');

const privateKey = fs.readFileSync('private.pem', 'utf8');
const sign = crypto.createSign('SHA256');
sign.update(challenge);
sign.end();
const signature = sign.sign(privateKey, 'base64');
```

## エラーハンドリング

### クライアント側
- ネットワークエラー時はリトライ
- チャレンジ期限切れ時は再取得
- 署名検証失敗時は鍵の確認を促す

### Worker側
- 不正なリクエスト形式: 400エラー
- 認証失敗: 401エラー
- 内部エラー: 500エラー

## CORS設定
すべてのオリジンからのアクセスを許可（必要に応じて制限）:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## デプロイ

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 環境変数とSecret変数の設定

wrangler.tomlに公開鍵を追加:
```toml
[vars]
AUTHORIZED_CLIENTS = '{"client1":"-----BEGIN PUBLIC KEY-----\n..."}'
```

Secret変数を設定:
```bash
wrangler secret put SECRET_DATA
wrangler secret put API_KEY
```

### 3. デプロイ
```bash
npm run deploy
```

### 4. ローカル開発
```bash
npm run dev
```

## 制限事項

### 現在の実装
- チャレンジはメモリ保存（Worker再起動で消失）
- 複数インスタンス間での状態共有なし

### 本番環境推奨
- Cloudflare KVを使用してチャレンジを保存
- セッション管理にDurable Objectsを使用
- レート制限の実装
- IPホワイトリストの実装

## 拡張可能性

- **マルチテナント**: clientIdごとに異なるSecret変数を返す
- **権限管理**: clientIdごとにアクセス可能なSecretを制限
- **監査ログ**: 認証履歴をKVまたは外部サービスに記録
- **トークンベース認証**: 初回認証後はJWTトークンで認証
