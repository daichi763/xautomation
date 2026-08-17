// X (Twitter) API v2 直接接続
// OAuth 1.0a User Context 署名を Web Crypto API (HMAC-SHA1) で実装 — Workers完全対応
//
// 必要なシークレット (X Developer Portal で取得):
//   X_API_KEY             (Consumer Key)
//   X_API_SECRET          (Consumer Secret)
//   X_ACCESS_TOKEN        (Access Token — 投稿するアカウントのもの)
//   X_ACCESS_TOKEN_SECRET (Access Token Secret)

export interface XCredentials {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

export function getXCredentials(env: Record<string, string | undefined>): XCredentials | null {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = env
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) return null
  return {
    apiKey: X_API_KEY,
    apiSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessTokenSecret: X_ACCESS_TOKEN_SECRET,
  }
}

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

async function hmacSha1(key: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function buildOAuthHeader(
  creds: XCredentials,
  method: string,
  url: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }
  // 署名ベース文字列 (JSONボディはOAuth1.0a署名に含めない)
  const allParams = { ...oauthParams, ...extraParams }
  const paramString = Object.keys(allParams).sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&')
  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&')
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`
  const signature = await hmacSha1(signingKey, baseString)

  const header = { ...oauthParams, oauth_signature: signature }
  return 'OAuth ' + Object.keys(header).sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(header[k])}"`).join(', ')
}

export interface XPostResult {
  ok: boolean
  tweetId?: string
  tweetUrl?: string
  error?: string
}

// テキスト投稿 (画像付きの場合は事前にuploadMediaでmedia_id取得)
export async function postTweet(creds: XCredentials, text: string, mediaIds?: string[]): Promise<XPostResult> {
  const url = 'https://api.twitter.com/2/tweets'
  try {
    const auth = await buildOAuthHeader(creds, 'POST', url)
    const body: any = { text }
    if (mediaIds?.length) body.media = { media_ids: mediaIds }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data: any = await res.json()
    if (!res.ok) {
      const detail = data?.detail || data?.errors?.[0]?.message || data?.title || `HTTP ${res.status}`
      return { ok: false, error: detail }
    }
    const tweetId = data.data?.id
    return { ok: true, tweetId, tweetUrl: tweetId ? `https://x.com/i/web/status/${tweetId}` : undefined }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'ネットワークエラー' }
  }
}

// 画像アップロード (v1.1 media/upload — v2投稿と併用可)
export async function uploadMedia(creds: XCredentials, imageB64: string): Promise<{ ok: boolean; mediaId?: string; error?: string }> {
  const url = 'https://upload.twitter.com/1.1/media/upload.json'
  try {
    // media_data はボディパラメータとして署名に含める (form-encoded)
    const auth = await buildOAuthHeader(creds, 'POST', url, { media_data: imageB64 })
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `media_data=${percentEncode(imageB64)}`,
    })
    const data: any = await res.json()
    if (!res.ok) return { ok: false, error: data?.errors?.[0]?.message || `HTTP ${res.status}` }
    return { ok: true, mediaId: data.media_id_string }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'ネットワークエラー' }
  }
}
