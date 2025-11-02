# Go Backend 認証トークン仕様

## 概要
Cloudflare Auth Workerとの認証フローにおいて、`/verify`エンドポイントから返される`accessToken`を使用した認証方式の仕様です。

## 認証フロー

### 1. チャレンジ取得
```
POST https://cloudflare-auth-worker.m-tama-ramu.workers.dev/challenge
Content-Type: application/json

{
  "clientId": "gowinproc"
}
```

**レスポンス:**
```json
{
  "challenge": "Base64エンコードされたランダムな32バイト",
  "expiresAt": 1234567890000
}
```

### 2. 署名検証とトークン取得
```
POST https://cloudflare-auth-worker.m-tama-ramu.workers.dev/verify
Content-Type: application/json

{
  "clientId": "gowinproc",
  "challenge": "受け取ったチャレンジ（そのまま）",
  "signature": "Base64エンコードされた署名",
  "tunnelUrl": "https://your-tunnel.trycloudflare.com",
  "repoUrl": "https://github.com/owner/repo",
  "grpcEndpoint": "localhost:50051",
  "includeRepoList": true
}
```

**署名生成方法（重要）:**
```go
// challengeはUTF-8文字列としてそのまま署名
challengeBytes := []byte(challengeB64)  // Base64デコードしない！

// SHA-256ハッシュを計算
hashed := sha256.Sum256(challengeBytes)

// RSA秘密鍵で署名
signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hashed[:])
if err != nil {
    return err
}

// Base64エンコードして送信
signatureB64 := base64.StdEncoding.EncodeToString(signature)
```

**レスポンス:**
```json
{
  "success": true,
  "token": "JWT トークン（従来の形式、後方互換性のため残存）",
  "accessToken": "Base64エンコードされたランダムな32バイトトークン",
  "secretData": {
    "SECRET_DATA": "機密情報",
    "OTHER_SECRET": "その他の機密情報"
  },
  "repoList": ["https://github.com/owner/repo1", "https://github.com/owner/repo2"]
}
```

### 3. accessTokenの保存
`accessToken`をメモリまたは設定ファイルに保存します。

```go
type AuthConfig struct {
    ClientID    string
    AccessToken string
    TunnelURL   string
}

// /verifyのレスポンスから取得
config := &AuthConfig{
    ClientID:    "gowinproc",
    AccessToken: response.AccessToken,
    TunnelURL:   "https://your-tunnel.trycloudflare.com",
}
```

## 認証が必要なエンドポイント

### Tunnel URL 更新
トンネルURLが変更された場合に使用します。

```
POST https://cloudflare-auth-worker.m-tama-ramu.workers.dev/tunnel/register
Content-Type: application/json

{
  "clientId": "gowinproc",
  "tunnelUrl": "https://new-tunnel.trycloudflare.com",
  "token": "保存しているaccessToken"
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "clientId": "gowinproc",
    "tunnelUrl": "https://new-tunnel.trycloudflare.com",
    "token": "accessToken",
    "updatedAt": 1234567890000,
    "createdAt": 1234567890000
  }
}
```

### Tunnel URL 取得
特定のクライアントのトンネルURL情報を取得します。

```
GET https://cloudflare-auth-worker.m-tama-ramu.workers.dev/tunnel/gowinproc
Authorization: Bearer {accessToken}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "clientId": "gowinproc",
    "tunnelUrl": "https://your-tunnel.trycloudflare.com",
    "token": "accessToken",
    "updatedAt": 1234567890000,
    "createdAt": 1234567890000
  }
}
```

## トークンのライフサイクル

### トークンの有効期限
- **有効期限なし**: トンネルURLは頻繁に変更されるため、トークンに有効期限は設定されていません
- トンネルURLが変更されるたびに新しい`/verify`認証を実行し、新しい`accessToken`を取得することを推奨します

### トークンの再取得タイミング
1. **トンネル再起動時**: 必ず新しい`accessToken`を取得
2. **401エラー発生時**: トークンが無効化された可能性があるため再認証
3. **定期的な再認証**: セキュリティベストプラクティスとして24時間ごとに再認証を推奨

## Go実装例

### 完全な認証フロー
```go
package main

import (
    "bytes"
    "crypto"
    "crypto/rand"
    "crypto/rsa"
    "crypto/sha256"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

type AuthClient struct {
    ClientID    string
    PrivateKey  *rsa.PrivateKey
    WorkerURL   string
    AccessToken string
    TunnelURL   string
}

// チャレンジ取得
func (c *AuthClient) GetChallenge() (string, error) {
    payload := map[string]string{"clientId": c.ClientID}
    body, _ := json.Marshal(payload)

    resp, err := http.Post(c.WorkerURL+"/challenge", "application/json", bytes.NewBuffer(body))
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()

    var result struct {
        Challenge string `json:"challenge"`
        ExpiresAt int64  `json:"expiresAt"`
    }

    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return "", err
    }

    return result.Challenge, nil
}

// 署名生成
func (c *AuthClient) SignChallenge(challenge string) (string, error) {
    // challengeをUTF-8バイト列として扱う（Base64デコードしない！）
    challengeBytes := []byte(challenge)

    // SHA-256ハッシュ
    hashed := sha256.Sum256(challengeBytes)

    // RSA署名
    signature, err := rsa.SignPKCS1v15(rand.Reader, c.PrivateKey, crypto.SHA256, hashed[:])
    if err != nil {
        return "", err
    }

    // Base64エンコード
    return base64.StdEncoding.EncodeToString(signature), nil
}

// 認証実行
func (c *AuthClient) Authenticate(tunnelURL, repoURL, grpcEndpoint string) error {
    // 1. チャレンジ取得
    challenge, err := c.GetChallenge()
    if err != nil {
        return fmt.Errorf("failed to get challenge: %w", err)
    }

    // 2. 署名生成
    signature, err := c.SignChallenge(challenge)
    if err != nil {
        return fmt.Errorf("failed to sign challenge: %w", err)
    }

    // 3. 検証リクエスト
    payload := map[string]interface{}{
        "clientId":        c.ClientID,
        "challenge":       challenge,
        "signature":       signature,
        "tunnelUrl":       tunnelURL,
        "repoUrl":         repoURL,
        "grpcEndpoint":    grpcEndpoint,
        "includeRepoList": true,
    }

    body, _ := json.Marshal(payload)
    resp, err := http.Post(c.WorkerURL+"/verify", "application/json", bytes.NewBuffer(body))
    if err != nil {
        return fmt.Errorf("failed to verify: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        bodyBytes, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("authentication failed: %s", string(bodyBytes))
    }

    var result struct {
        Success     bool              `json:"success"`
        Token       string            `json:"token"`
        AccessToken string            `json:"accessToken"`
        SecretData  map[string]string `json:"secretData"`
        RepoList    []string          `json:"repoList"`
    }

    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return fmt.Errorf("failed to decode response: %w", err)
    }

    // 4. accessTokenを保存
    c.AccessToken = result.AccessToken
    c.TunnelURL = tunnelURL

    fmt.Printf("Authentication successful! AccessToken: %s\n", c.AccessToken[:20]+"...")
    return nil
}

// トンネルURL更新
func (c *AuthClient) UpdateTunnelURL(newTunnelURL string) error {
    payload := map[string]string{
        "clientId":  c.ClientID,
        "tunnelUrl": newTunnelURL,
        "token":     c.AccessToken,
    }

    body, _ := json.Marshal(payload)
    resp, err := http.Post(c.WorkerURL+"/tunnel/register", "application/json", bytes.NewBuffer(body))
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        bodyBytes, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("failed to update tunnel: %s", string(bodyBytes))
    }

    c.TunnelURL = newTunnelURL
    return nil
}

func main() {
    // RSA秘密鍵を読み込む
    privateKey, err := loadPrivateKey("private_key.pem")
    if err != nil {
        panic(err)
    }

    client := &AuthClient{
        ClientID:   "gowinproc",
        PrivateKey: privateKey,
        WorkerURL:  "https://cloudflare-auth-worker.m-tama-ramu.workers.dev",
    }

    // 認証実行
    err = client.Authenticate(
        "https://your-tunnel.trycloudflare.com",
        "https://github.com/owner/repo",
        "localhost:50051",
    )
    if err != nil {
        panic(err)
    }

    // トンネルURL更新（必要に応じて）
    err = client.UpdateTunnelURL("https://new-tunnel.trycloudflare.com")
    if err != nil {
        panic(err)
    }
}
```

## エラーハンドリング

### 401 Unauthorized
- トークンが無効または期限切れ
- 対処: 新しい`/verify`認証を実行

### 400 Bad Request
- リクエストパラメータが不足または不正
- 対処: リクエストボディを確認

### 404 Not Found
- トンネルURLが登録されていない
- 対処: `/verify`で初回登録を実行

## セキュリティ考慮事項

1. **accessTokenの保護**: メモリ内に保持し、ファイルに保存する場合は暗号化すること
2. **HTTPS通信**: すべての通信はHTTPS経由で行うこと
3. **秘密鍵の管理**: RSA秘密鍵は安全な場所に保管し、環境変数またはシークレット管理サービスを使用すること
4. **ログ**: accessTokenやsignatureをログに出力しないこと
