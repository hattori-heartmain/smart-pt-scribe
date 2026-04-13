// ===== スクリプトプロパティに GEMINI_API_KEY を設定してください =====
// GASエディタ → プロジェクトの設定 → スクリプトプロパティ → 追加
//   プロパティ名: GEMINI_API_KEY
//   値: あなたのGemini APIキー

const MODELS = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const SYSTEM_PROMPT_INITIAL = `
<role>あなたは診療録作成を担当する「医師事務作業補助者（シュライバー）」です。</role>
<task>医師-患者の「書き起こし」および「診察メモ」から、初診用のSOAP形式診療録を作成してください。</task>
<constraints priority="high">
 - 推論過程は出力しない。
 - 薬剤名は書き起こしの表記をそのまま出力すること。
 - 重要：書き起こしやメモに情報がない項目、数値が言及されていない項目は、項目名を含め出力から完全に除外すること。
</constraints>
<output_format>
【S: Subjective】
主訴: / 発症時期: / 経過: / 痛み部位: / 痛みの性質: / NRS: / 時間帯変化: / 増悪因子: / 24時間パターン: / 既往歷: / 内科的既往:
---------------------------------
【O: Objective】
姿勢観察: / 自動運動検査> (前屈/側屈/運動パターン/反復運動) / ROM(腰椎) / ROM(股関節) / ROM(胸椎) / 柔軟性 (SLR/Thomas/PLF test) / 分節検査 / 触診
---------------------------------
【A: Assessment】
(評価内容) / 増悪因子:
---------------------------------
【P: Plan】
徒手療法: / 短期目標: / 長期目標: / 再評価項目:
</output_format>
`;

const SYSTEM_PROMPT_RE_EXAM = `
<role>あなたは診療録作成を担当する「医師事務作業補助者（シュライバー）」です。</role>
<task>医師-患者の「書き起こし」および「診察メモ」から、再診（毎日の経過）用の診療録を作成してください。</task>
<constraints priority="high">
 - 推論過程は出力しない。
 - 薬剤名は書き起こしの表記をそのまま出力すること。
 - 重要：情報がない基本動作や項目は、出力から完全に除外すること。
</constraints>
<output_format>
＜subject＞
(患者の訴えを要約)

＜現在の基本動作レベル＞
・起き上がり⇒ / ・立ち上がり⇒ / ・立位保持⇒ / ・移乗動作⇒ / ・歩行動作⇒

＜assessment＞
(評価内容)

＜今回のリハの実施内容＞
(実施したアプローチ)

＜今後の流れ＞
(次回の予定や方針)
</output_format>
`;

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { input, examType } = data;

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'GEMINI_API_KEY がスクリプトプロパティに設定されていません。' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const systemPrompt = examType === 'initial' ? SYSTEM_PROMPT_INITIAL : SYSTEM_PROMPT_RE_EXAM;

    let text = '';
    let lastError = '';

    for (const model of MODELS) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          Utilities.sleep(RETRY_DELAY_MS * attempt);
        }

        const response = UrlFetchApp.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
              contents: [{ parts: [{ text: input }] }],
              systemInstruction: { parts: [{ text: systemPrompt }] }
            }),
            muteHttpExceptions: true
          }
        );

        const result = JSON.parse(response.getContentText());

        if (!result.error) {
          text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) {
            return ContentService.createTextOutput(JSON.stringify({ result: text, model: model }))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }

        lastError = result.error?.message || 'レスポンスが空です';
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ error: lastError }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('Smart PT Scribe API is running.');
}
