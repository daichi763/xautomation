// Aki(画像): 枠3「ノウハウ図解」の自動生成(指示書 L244-260 準拠)
// フロー: 原稿から視覚化ポイント抽出(gpt-5) → gpt-image-2生成 → R2保存 → Mio画像QA → NG時1回だけ再生成
import { callOpenAI } from './llm'
import { buildImagePrompt, generateImage, qaImage, IMAGE_SIZE, IMAGE_COST_USD } from './image-gen'

const AKI_EXTRACT_SYSTEM = `あなたは「Aki」— 日本のXアカウント「Mさん / 海外AI副業の検証部屋」の画像デザイナーです。
X投稿の原稿から、1枚の図解画像にする内容を設計します。

## 設計ルール
- 図解タイトルは15字以内の日本語(画像に大きく描画される)
- ステップ図・比較図・構造図のいずれかに落とし込む
- 画像内テキストは最小限(タイトル+3〜5個の短いラベル)。長文は入れない
- 「誰でも」「必ず」「簡単に稼げる」等の断定表現は画像内でも禁止

## 出力形式(必ずこのJSONのみ)
{
  "title": "図解タイトル(15字以内)",
  "labels": ["ラベル1", "ラベル2", "ラベル3"],
  "layout_hint": "step diagram with 3 numbered boxes 等、英語のレイアウト指示1文"
}`

export interface AkiResult {
  ok: boolean
  imageId?: string
  title?: string
  qaStatus?: string
  costUsd: number
  error?: string
}

// 枠3投稿の本文から図解画像を生成し、x_posts.image_urls に添付
export async function runAkiInfographic(
  db: D1Database,
  r2: R2Bucket,
  apiKey: string,
  postId: string,
  postBody: string,
  topicTitle: string,
): Promise<AkiResult> {
  const result: AkiResult = { ok: false, costUsd: 0 }
  try {
    // ① 視覚化ポイント抽出
    const extract = await callOpenAI(
      apiKey,
      'gpt-5',
      AKI_EXTRACT_SYSTEM,
      `以下のX投稿(枠3: ノウハウ図解)の原稿から図解を設計してください。\n\n▓ネタ: ${topicTitle}\n▓投稿本文:\n${postBody}`,
      4000,
      'low',
    )
    if (!extract.ok) {
      result.error = `図解設計失敗: ${extract.error}`
      return result
    }
    result.costUsd += extract.costUsd || 0

    let title = topicTitle.slice(0, 15)
    let labels: string[] = []
    let layoutHint = ''
    try {
      const jsonText = extract.content.replace(/^```json?\s*/, '').replace(/```\s*$/, '').trim()
      const parsed = JSON.parse(jsonText)
      if (parsed.title) title = String(parsed.title).slice(0, 20)
      if (Array.isArray(parsed.labels)) labels = parsed.labels.slice(0, 5).map((l: any) => String(l))
      if (parsed.layout_hint) layoutHint = String(parsed.layout_hint)
    } catch {
      /* 抽出失敗時はタイトルのみで生成 */
    }

    const extra = [layoutHint, labels.length ? `Japanese labels: ${labels.map((l) => `"${l}"`).join(', ')}` : ''].filter(Boolean).join(', ')

    // ② 生成 → ③ QA(needs_fix/ng なら1回だけ再生成)
    let finalB64: string | null = null
    let finalQa: any = null
    let prompt = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      prompt = buildImagePrompt('infographic', title, extra + (attempt > 0 ? ', extra attention to accurate Japanese text rendering' : ''))
      const gen = await generateImage(apiKey, prompt, IMAGE_SIZE.infographic)
      if (!gen.ok || !gen.b64) {
        result.error = `画像生成失敗: ${gen.error}`
        if (attempt === 0) continue
        return result
      }
      result.costUsd += IMAGE_COST_USD

      const qa = await qaImage(apiKey, gen.b64, title)
      if (qa.ok) result.costUsd += qa.costUsd || 0
      const verdict = qa.ok ? qa.verdict || 'unknown' : 'unknown'

      finalB64 = gen.b64
      finalQa = { verdict, issues: qa.issues || [], summary: qa.summary || qa.error || '' }
      if (verdict === 'ok') break
      // needs_fix/ng → 再生成(2回目の結果はそのまま採用し、QA状態を記録)
    }

    if (!finalB64) {
      result.error = result.error || '画像生成に失敗しました'
      return result
    }

    // ④ R2保存 + DB登録 + 投稿に添付
    const imageId = `img-auto-${Date.now()}`
    const r2Key = `images/${imageId}.png`
    const binary = Uint8Array.from(atob(finalB64), (ch) => ch.charCodeAt(0))
    await r2.put(r2Key, binary, { httpMetadata: { contentType: 'image/png' } })

    const qaStatus = finalQa?.verdict === 'ok' ? 'ok' : finalQa?.verdict === 'ng' ? 'ng' : 'needs_fix'
    await db
      .prepare(
        `INSERT INTO generated_images (image_id, post_id, purpose, prompt, title_text, r2_key, model, qa_status, qa_issues, cost_usd)
         VALUES (?, ?, 'infographic', ?, ?, ?, 'gpt-image-2', ?, ?, ?)`,
      )
      .bind(imageId, postId, prompt, title, r2Key, qaStatus, JSON.stringify(finalQa?.issues || []), result.costUsd)
      .run()

    await db
      .prepare(`UPDATE x_posts SET image_urls = ? WHERE post_id = ?`)
      .bind(JSON.stringify([`/api/images/${imageId}/file`]), postId)
      .run()

    result.ok = true
    result.imageId = imageId
    result.title = title
    result.qaStatus = qaStatus
    return result
  } catch (e: any) {
    result.error = e?.message || 'Aki実行エラー'
    return result
  }
}

// ============================================================
// note記事のカバー画像を生成(Phase D: 画像増産 — note読了率・購入率の向上)
// 有料記事は購入判断に直結するため必ず、無料記事も毎日生成
// ============================================================
export async function runAkiNoteCover(
  db: D1Database,
  r2: R2Bucket,
  apiKey: string,
  articleId: string,
  articleTitle: string,
  articleType: string,
): Promise<AkiResult> {
  const result: AkiResult = { ok: false, costUsd: 0 }
  try {
    const shortTitle = articleTitle.replace(/[|｜].*$/, '').slice(0, 22)
    const badge = articleType === 'monthly_summary' ? '月次まとめ' : articleType === 'paid_single' ? '有料検証' : articleType === 'membership' ? 'メンバー限定' : ''
    const extra = badge ? `small orange badge label "${badge}" in top-left corner` : ''

    const prompt = buildImagePrompt('note_cover', shortTitle, extra)
    const gen = await generateImage(apiKey, prompt, IMAGE_SIZE.note_cover)
    if (!gen.ok || !gen.b64) {
      result.error = `noteカバー生成失敗: ${gen.error}`
      return result
    }
    result.costUsd += IMAGE_COST_USD

    const qa = await qaImage(apiKey, gen.b64, shortTitle)
    if (qa.ok) result.costUsd += qa.costUsd || 0
    const verdict = qa.ok ? qa.verdict || 'unknown' : 'unknown'
    const qaStatus = verdict === 'ok' ? 'ok' : verdict === 'ng' ? 'ng' : 'needs_fix'

    const imageId = `img-cover-${Date.now()}`
    const r2Key = `images/${imageId}.png`
    const binary = Uint8Array.from(atob(gen.b64), (ch) => ch.charCodeAt(0))
    await r2.put(r2Key, binary, { httpMetadata: { contentType: 'image/png' } })

    await db
      .prepare(
        `INSERT INTO generated_images (image_id, post_id, purpose, prompt, title_text, r2_key, model, qa_status, qa_issues, cost_usd)
         VALUES (?, NULL, 'note_cover', ?, ?, ?, 'gpt-image-2', ?, ?, ?)`,
      )
      .bind(imageId, prompt, shortTitle, r2Key, qaStatus, JSON.stringify(qa.issues || []), result.costUsd)
      .run()

    await db.prepare(`UPDATE note_articles SET cover_image_id = ? WHERE article_id = ?`).bind(imageId, articleId).run()

    result.ok = true
    result.imageId = imageId
    result.title = shortTitle
    result.qaStatus = qaStatus
    return result
  } catch (e: any) {
    result.error = e?.message || 'Akiカバー生成エラー'
    return result
  }
}
