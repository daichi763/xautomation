// Nana: KPI自動収集(毎朝パイプライン内で実行)
// 自動で取れるもの: Xフォロワー数(X API無料枠 /2/users/me)、noteフォロワー数・記事スキ数(note公開API)
// 手動入力が必要なもの: Xインプレッション、note閲覧数/売上、メンバー数、アフィ収益 → ダッシュボードの数値入力フォームから
import { getXCredentials, fetchMyProfile } from './x-api'

export interface KpiCollectResult {
  ok: boolean
  xFollowers?: number
  noteFollowers?: number
  noteLikesTotal?: number
  sources: string[]
  errors: string[]
}

// note公開API: クリエイター情報(フォロワー数)
async function fetchNoteCreator(urlname: string): Promise<{ followers?: number; error?: string }> {
  try {
    const res = await fetch(`https://note.com/api/v2/creators/${encodeURIComponent(urlname)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    })
    if (!res.ok) return { error: `note API HTTP ${res.status}` }
    const data: any = await res.json()
    const followers = data?.data?.followerCount
    return typeof followers === 'number' ? { followers } : { error: 'note APIレスポンス形式不明' }
  } catch (e: any) {
    return { error: e?.message || 'note API接続エラー' }
  }
}

// note公開API: 記事一覧(スキ数合計 — エンゲージメント代替指標)
async function fetchNoteLikes(urlname: string): Promise<{ likes?: number; error?: string }> {
  try {
    const res = await fetch(`https://note.com/api/v2/creators/${encodeURIComponent(urlname)}/contents?kind=note&page=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    })
    if (!res.ok) return { error: `note contents API HTTP ${res.status}` }
    const data: any = await res.json()
    const contents = data?.data?.contents
    if (!Array.isArray(contents)) return { error: 'note contents形式不明' }
    const likes = contents.reduce((s: number, c: any) => s + (c?.likeCount || 0), 0)
    return { likes }
  } catch (e: any) {
    return { error: e?.message || 'note contents接続エラー' }
  }
}

// app_settings から note ユーザー名を取得
export async function getNoteUsername(db: D1Database): Promise<string | null> {
  const row: any = await db.prepare(`SELECT value FROM app_settings WHERE key = 'note_username'`).first()
  return row?.value || null
}

// 自動収集 → kpi_daily にUPSERT(手動入力済みの列は上書きしない)
export async function collectKpiAuto(db: D1Database, env: Record<string, string | undefined>): Promise<KpiCollectResult> {
  const result: KpiCollectResult = { ok: false, sources: [], errors: [] }
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) // JST

  // ① Xフォロワー数
  const creds = getXCredentials(env)
  if (creds) {
    const prof = await fetchMyProfile(creds)
    if (prof.ok) {
      result.xFollowers = prof.followers
      result.sources.push(`X API(@${prof.username})`)
    } else {
      result.errors.push(`Xフォロワー取得失敗: ${prof.error}`)
    }
  } else {
    result.errors.push('X APIキー未設定のためフォロワー数は取得スキップ')
  }

  // ② noteフォロワー数・スキ数
  const noteUser = await getNoteUsername(db)
  if (noteUser) {
    const creator = await fetchNoteCreator(noteUser)
    if (creator.followers !== undefined) {
      result.noteFollowers = creator.followers
      result.sources.push(`note API(${noteUser})`)
    } else if (creator.error) {
      result.errors.push(`noteフォロワー取得失敗: ${creator.error}`)
    }
    const likes = await fetchNoteLikes(noteUser)
    if (likes.likes !== undefined) result.noteLikesTotal = likes.likes
  } else {
    result.errors.push('noteユーザー名未設定(設定画面から登録するとnote指標を自動取得します)')
  }

  // ③ kpi_daily にUPSERT(自動取得できた列のみ更新。手動列は保持)
  if (result.xFollowers !== undefined || result.noteFollowers !== undefined) {
    await db
      .prepare(
        `INSERT INTO kpi_daily (date, x_followers, note_followers)
         VALUES (?, COALESCE(?, 0), COALESCE(?, 0))
         ON CONFLICT(date) DO UPDATE SET
           x_followers = COALESCE(?, x_followers),
           note_followers = COALESCE(?, note_followers)`,
      )
      .bind(today, result.xFollowers ?? null, result.noteFollowers ?? null, result.xFollowers ?? null, result.noteFollowers ?? null)
      .run()
  }

  result.ok = result.sources.length > 0
  return result
}
