// Yuto note記事自動執筆: 週7本(無料6・有料1)。日曜=有料note(ゲート③でpaywall位置つき全文プレビュー)
// 品質優先方針: noteは収益の柱のため gpt-5 + 推論high で長文品質を最大化
import { callOpenAI, type LlmResult } from './llm'
import { runQaCheck } from './qa-rules'

export const YUTO_NOTE_SYSTEM = `あなたは「Yuto」— 日本のnoteアカウント「Mさん / 海外AI副業の検証部屋」の専属ライターです。

## アカウント設定
- 発信者: 会社員をしながら海外のAI副業情報を検証しているMさん(一人称は「僕」)
- 読者: 副業未経験〜初心者の日本人。専門用語を知らない前提
- トーン: 誠実・等身大・検証者目線。煽らない。「稼げる」と断定しない

## note執筆ルール(必須)
1. 固有名詞の初出には必ず1行注釈。形式:「※KDP=Amazonで誰でも無料で電子書籍を出せる仕組み」
2. 金額は円換算を先に。形式:「月45万円($3,000)」
3. Markdown形式。見出し(##/###)、箇条書き、太字を活用して読みやすく
4. 冒頭に「この記事でわかること」を箇条書きで提示
5. 具体的な手順・数字・出典を含め、読者が今日から動ける内容にする
6. 文末に「僕の検証メモ」として一次情報への姿勢・注意点を添える

## 有料記事の場合の追加ルール(最重要)
- 無料部分だけでも読者に明確な価値がある構成にする(出し惜しみ感を出さない)
- 有料部分で完結する(具体手順・テンプレート・数字の深掘りは有料側)
- paywall(有料ライン)の直前に「ここから先で得られるもの」を1〜2行で明示

## 法務ルール(絶対厳守)
- 「誰でも」「簡単に」「必ず」「確実に」稼げる系の断定表現は禁止(景表法)
- 収益は「〜という報告がある」「検証中」など伝聞・過程として書く
- 投資・仮想通貨の利益保証めいた表現は禁止(金商法)
- 健康・医療効果の主張は禁止(薬機法)

出力は記事本文(Markdown)のみ。1行目は「# タイトル」。有料記事の場合、paywall位置に単独行で「<!--paywall-->」を挿入すること。`

export interface NoteWriterResult {
  ok: boolean
  articleId?: string
  title?: string
  type: 'free' | 'paid_single'
  qaStatus?: string
  costUsd: number
  error?: string
}

// JSTの曜日 (0=日曜)
function jstDay(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
}

// 今日のnote種別: 日曜=有料(週1)、それ以外=無料(週6)
export function todayNoteType(): 'free' | 'paid_single' {
  return jstDay() === 0 ? 'paid_single' : 'free'
}

// note記事1本を執筆(パイプラインから日次で呼ばれる)
export async function runNoteWriter(
  db: D1Database,
  apiKey: string,
  topic: { topic_id: string; title_ja: string; why_hit?: string },
  kaiMarkdown: string,
): Promise<NoteWriterResult> {
  const type = todayNoteType()
  const result: NoteWriterResult = { ok: false, type, costUsd: 0 }
  try {
    // 用語集(注釈の一貫性)
    const gl = await db.prepare('SELECT term, annotation FROM glossary LIMIT 30').all()
    const glossaryNote = ((gl.results || []) as any[]).map((g) => `※${g.term}=${g.annotation}`).join('\n')

    // 直近のnoteタイトル(重複回避)
    const recent = await db
      .prepare(`SELECT title FROM note_articles WHERE created_at > datetime('now', '-14 days') ORDER BY created_at DESC LIMIT 14`)
      .all()
    const recentTitles = ((recent.results || []) as any[]).map((r) => `- ${r.title}`).join('\n') || '(なし)'

    const isPaid = type === 'paid_single'
    const priceYen = isPaid ? 500 : 0
    const spec = isPaid
      ? `## 今回の依頼: 有料note記事(500円)
- 分量: 3000〜4500字
- 無料部分(paywallより前): 800〜1200字。問題提起+概要+「ここから先で得られるもの」
- 有料部分: 具体手順のステップバイステップ、実際の数字、つまずきポイントと回避策、テンプレートや文例
- paywall位置に単独行で「<!--paywall-->」を必ず挿入`
      : `## 今回の依頼: 無料note記事
- 分量: 2000〜3000字
- 全文無料。X投稿では書ききれない深掘り・背景・手順の詳細を提供
- 文中に自然な形で「有料noteでさらに詳しく検証中」の一言を1回だけ入れて良い(押し売り禁止)`

    const userPrompt = `${spec}

## ネタ
タイトル: ${topic.title_ja}
刺さる理由: ${topic.why_hit || '—'}

## Kai(翻訳担当)による原文の翻訳・要約
${kaiMarkdown.slice(0, 4000)}

## 直近14日のnoteタイトル(重複回避)
${recentTitles}

## 既存の用語注釈集(同じ固有名詞はこの注釈を使う)
${glossaryNote}`

    const llm: LlmResult = await callOpenAI(apiKey, 'gpt-5', YUTO_NOTE_SYSTEM, userPrompt, 24000, 'high') // 推論(high)+長文本文の予算
    if (!llm.ok) {
      result.error = `note執筆失敗: ${llm.error}`
      return result
    }
    result.costUsd = llm.costUsd || 0

    let bodyMd = llm.content.trim()

    // タイトル抽出(1行目の # )
    const titleMatch = bodyMd.match(/^#\s+(.+)$/m)
    const title = (titleMatch ? titleMatch[1] : topic.title_ja).trim().slice(0, 100)

    // paywall位置(有料のみ): <!--paywall--> の文字オフセット
    let paywallPosition: number | null = null
    if (isPaid) {
      const idx = bodyMd.indexOf('<!--paywall-->')
      if (idx >= 0) {
        paywallPosition = idx
      } else {
        // マーカーが無い場合は本文の1/3地点の直近段落境界に挿入
        const third = Math.floor(bodyMd.length / 3)
        const breakIdx = bodyMd.indexOf('\n\n', third)
        const insertAt = breakIdx > 0 ? breakIdx + 2 : third
        bodyMd = bodyMd.slice(0, insertAt) + '<!--paywall-->\n\n' + bodyMd.slice(insertAt)
        paywallPosition = insertAt
      }
    }

    // Mio QA(キーワードエンジン)+1回だけ自動リライト
    let qa = runQaCheck(bodyMd, /\bhttps?:\/\//.test(bodyMd))
    if (qa.status !== 'ok') {
      const rewrite = await callOpenAI(
        apiKey,
        'gpt-5',
        YUTO_NOTE_SYSTEM,
        `以下のnote記事がQAで指摘を受けました。指摘を解消しつつ構成・分量・${isPaid ? 'paywallマーカー(<!--paywall-->)' : '無料記事の形式'}を維持して書き直してください。書き直した記事全文(Markdown)のみを出力:\n\n▓指摘:\n${qa.issues.map((i) => `- ${i.law}: ${i.matched}(${i.detail})`).join('\n')}\n\n▓元の記事:\n${bodyMd}`,
        16000,
        'medium',
      )
      if (rewrite.ok) {
        result.costUsd += rewrite.costUsd || 0
        const qa2 = runQaCheck(rewrite.content, /\bhttps?:\/\//.test(rewrite.content))
        if (qa2.status === 'ok' || (qa2.status === 'needs_fix' && qa.status === 'ng')) {
          bodyMd = rewrite.content.trim()
          if (isPaid) {
            const idx2 = bodyMd.indexOf('<!--paywall-->')
            paywallPosition = idx2 >= 0 ? idx2 : paywallPosition
          }
          qa = qa2
        }
      }
    }

    const articleId = `na-${Date.now()}`
    await db
      .prepare(
        `INSERT INTO note_articles (article_id, topic_id, title, type, price_yen, body_md, paywall_position, approval_status, qa_status, qa_issues)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(articleId, topic.topic_id, title, type, priceYen, bodyMd, paywallPosition, qa.status, JSON.stringify(qa.issues))
      .run()

    result.ok = true
    result.articleId = articleId
    result.title = title
    result.qaStatus = qa.status
    return result
  } catch (e: any) {
    result.error = e?.message || 'note執筆エラー'
    return result
  }
}
