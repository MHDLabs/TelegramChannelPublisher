// ============================================================
//  Telegram Bot Worker — Final v2
//  + پشتیبانی از entities برای حفظ لینک‌های غیرتلگرام
//  + حذف کامل لینک‌ها/یوزرنیم‌های تلگرام
//  + ارسال با parse_mode HTML
// ============================================================

const STATES = {
  IDLE: "idle",
  WAITING_CHANNEL_FORWARD: "waiting_channel_forward",
  WAITING_DELETE_CHANNEL: "waiting_delete_channel",
  WAITING_SIGNATURE: "waiting_signature",
  WAITING_BAN_USER: "waiting_ban_user",
  WAITING_BROADCAST: "waiting_broadcast",
  WAITING_GLOBAL_POST: "waiting_global_post",
  WAITING_CAPTION_EDIT: "waiting_caption_edit"
};

const TG_API = "https://api.telegram.org/bot";
const MAX_CAPTION_LEN = 1024;
const MAX_TEXT_LEN = 4096;
const STATE_TTL_MS = 10 * 60 * 1000;

let DB_READY = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseSqliteUtc(s) {
  if (!s) return 0;
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

// ============================================================
//  Text / HTML / Telegram-link helpers
// ============================================================

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function isTelegramUrl(url) {
  if (!url) return false;
  const u = String(url).trim().toLowerCase();
  return /^https?:\/\/(t\.me|telegram\.me|telegram\.dog|telegram\.org)(\/|$)/i.test(u)
  || /^(t\.me|telegram\.me|telegram\.dog)(\/|$)/i.test(u)
  || /^tg:\/\//i.test(u);
}

// تبدیل متن ساده به HTML با لینک‌دار کردن URLها
function escapeAndLinkify(text) {
  if (!text) return "";
  const re = /https?:\/\/[^\s<>"']+/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.substring(last, m.index));
    const url = m[0];
    out += `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
    last = m.index + url.length;
  }
  out += escapeHtml(text.substring(last));
  return out;
}

// پاکسازی متن ساده (بدون entity) از لینک/یوزرنیم تلگرام
function stripTelegramPlain(text, mode) {
  if (!text) return "";
  let t = text;
  if (mode === "auto") {
    t = t.replace(/#[\w\u0600-\u06FF]+/g, "");
  }
  t = t.replace(/(^|\s)@[A-Za-z0-9_]{4,}/g, "$1");
  t = t.replace(/https?:\/\/(t\.me|telegram\.me|telegram\.dog|telegram\.org)\/[^\s]+/gi, "");
  t = t.replace(/(^|\s)(t\.me|telegram\.me|telegram\.dog)\/[^\s]+/gi, "$1");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// پردازش caption با entities — حذف telegram، حفظ non-telegram با anchor
function processWithEntities(text, entities, mode) {
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  let out = "";
  let cursor = 0;

  for (const ent of sorted) {
    const start = ent.offset;
    const end = Math.min(ent.offset + ent.length, text.length);
    if (start >= text.length) break;
    if (start > cursor) {
      const gap = text.substring(cursor, start);
      out += escapeAndLinkify(stripTelegramPlain(gap, "manual"));
    }

    const seg = text.substring(start, end);

    if (ent.type === "text_link" && ent.url) {
      if (isTelegramUrl(ent.url)) {
        // حذف کامل
      } else {
        out += `<a href="${escapeAttr(ent.url)}">${escapeHtml(seg)}</a>`;
      }
    } else if (ent.type === "url") {
      if (isTelegramUrl(seg)) {
        // حذف
      } else {
        const href = /^https?:\/\//i.test(seg) ? seg : "https://" + seg;
        out += `<a href="${escapeAttr(href)}">${escapeHtml(seg)}</a>`;
      }
    } else if (ent.type === "mention" || ent.type === "text_mention") {
      // حذف @mention
    } else if (ent.type === "hashtag" || ent.type === "cashtag") {
      if (mode === "manual") out += escapeHtml(seg);
      // auto: حذف (بعداً بازتولید می‌شود)
    } else if (ent.type === "bold") {
      out += `<b>${escapeHtml(seg)}</b>`;
    } else if (ent.type === "italic") {
      out += `<i>${escapeHtml(seg)}</i>`;
    } else if (ent.type === "underline") {
      out += `<u>${escapeHtml(seg)}</u>`;
    } else if (ent.type === "strikethrough") {
      out += `<s>${escapeHtml(seg)}</s>`;
    } else if (ent.type === "code") {
      out += `<code>${escapeHtml(seg)}</code>`;
    } else if (ent.type === "pre") {
      out += `<pre>${escapeHtml(seg)}</pre>`;
    } else if (ent.type === "spoiler") {
      out += `<tg-spoiler>${escapeHtml(seg)}</tg-spoiler>`;
    } else if (ent.type === "blockquote") {
      out += `<blockquote>${escapeHtml(seg)}</blockquote>`;
    } else {
      out += escapeHtml(seg);
    }

    cursor = end;
  }
  if (cursor < text.length) {
    out += escapeAndLinkify(stripTelegramPlain(text.substring(cursor), "manual"));
  }

  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// تابع اصلی: از متن خام + entities، HTML امن می‌سازد
function processUserText(rawText, entities, mode) {
  if (!rawText) return "";
  if (entities && entities.length > 0) {
    return processWithEntities(rawText, entities, mode);
  }
  const cleaned = stripTelegramPlain(rawText, mode);
  return escapeAndLinkify(cleaned);
}

// برای تولید هشتگ: HTML را حذف کن
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// ============================================================
//  Caption splitting / preview truncation (HTML-aware)
// ============================================================

function safeTruncateHtml(html, maxLen) {
  if (!html) return "";
  if (html.length <= maxLen) return html;
  let cut = maxLen;
  const lt = html.lastIndexOf("<", cut);
  const gt = html.lastIndexOf(">", cut);
  if (lt > gt) cut = lt;
  const before = html.substring(0, cut);
  const opens = (before.match(/<a\s/g) || []).length;
  const closes = (before.match(/<\/a>/g) || []).length;
  if (opens > closes) {
    const lastOpen = before.lastIndexOf("<a ");
    if (lastOpen > 0) cut = lastOpen;
  }
  return html.substring(0, cut);
}

function previewCaption(caption) {
  if (!caption) return "";
  if (caption.length <= MAX_CAPTION_LEN - 60) return caption;
  const note = "\n\n⚠️ کپشن بلند است؛ متن کامل به‌صورت پیام جداگانه ارسال می‌شود.";
  const budget = MAX_CAPTION_LEN - note.length - 5;
  return safeTruncateHtml(caption, budget) + note;
}

function splitHtml(html, maxLen) {
  const chunks = [];
  let rem = html;
  while (rem.length > maxLen) {
    let cut = maxLen;
    const nl = rem.lastIndexOf("\n", maxLen);
    if (nl > maxLen / 2) cut = nl;
    else {
      const sp = rem.lastIndexOf(" ", maxLen);
      if (sp > maxLen / 2) cut = sp;
    }
    const lt = rem.lastIndexOf("<", cut);
    const gt = rem.lastIndexOf(">", cut);
    if (lt > gt) cut = lt;
    const before = rem.substring(0, cut);
    const opens = (before.match(/<a\s/g) || []).length;
    const closes = (before.match(/<\/a>/g) || []).length;
    if (opens > closes) {
      const lastOpen = before.lastIndexOf("<a ");
      if (lastOpen > maxLen / 4) cut = lastOpen;
    }
    if (cut <= 0) cut = maxLen;
    chunks.push(rem.substring(0, cut));
    rem = rem.substring(cut).replace(/^\s+/, "");
  }
  if (rem) chunks.push(rem);
  return chunks;
}

// ============================================================
//  Telegram API
// ============================================================

async function tgRequest(method, payload, env) {
  const url = `${TG_API}${env.BOT_TOKEN}/${method}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
                            signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.error(`TG HTTP error: ${res.status} for ${method}`);
      return { ok: false, error_code: res.status, description: "HTTP Error" };
    }
    const data = await res.json();
    if (!data.ok) {
      console.error(`TG API error: ${data.error_code} ${data.description} for ${method}`);
      return {
        ok: false,
        error_code: data.error_code,
        description: data.description,
        parameters: data.parameters
      };
    }
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    console.error(`TG fetch error: ${e.message} for ${method}`);
    return { ok: false, error: e.message };
  }
}

async function safeTgCall(fn, maxRetries = 2) {
  let lastRes = { ok: false };
  for (let i = 0; i <= maxRetries; i++) {
    lastRes = await fn();
    if (lastRes && lastRes.ok) return lastRes;
    if (lastRes && lastRes.error_code === 429) {
      const retryAfter = (lastRes.parameters && lastRes.parameters.retry_after) || 1;
      await sleep((retryAfter + 1) * 1000);
      continue;
    }
    return lastRes;
  }
  return lastRes;
}

function isParseError(desc) {
  if (!desc) return false;
  const d = desc.toLowerCase();
  return d.includes("can't parse entities")
  || d.includes("can't find end")
  || d.includes("unsupported start tag")
  || d.includes("unmatched end tag");
}

async function sendMessage(chatId, text, replyMarkup, env, replyToMessageId, parseMode) {
  const payload = { chat_id: chatId, text: text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  if (parseMode) payload.parse_mode = parseMode;

  const res = await safeTgCall(() => tgRequest("sendMessage", payload, env));
  if (!res.ok && parseMode === "HTML" && isParseError(res.description)) {
    const plain = stripHtml(text);
    const fallback = { chat_id: chatId, text: plain };
    if (replyMarkup) fallback.reply_markup = replyMarkup;
    if (replyToMessageId) fallback.reply_to_message_id = replyToMessageId;
    return safeTgCall(() => tgRequest("sendMessage", fallback, env));
  }
  return res;
}

async function sendMedia(chatId, mediaType, fileId, caption, replyMarkup, env, replyToMessageId, parseMode) {
  const methodMap = {
    photo: "sendPhoto", video: "sendVideo", document: "sendDocument",
    audio: "sendAudio", voice: "sendVoice", animation: "sendAnimation"
  };
  const method = methodMap[mediaType];
  if (!method) return { ok: false, error: "Unsupported media type" };

  const payload = { chat_id: chatId };
  if (caption) payload.caption = caption.substring(0, MAX_CAPTION_LEN);
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  if (parseMode) payload.parse_mode = parseMode;

  if (method === "sendPhoto") payload.photo = fileId;
  else if (method === "sendVideo") payload.video = fileId;
  else if (method === "sendDocument") payload.document = fileId;
  else if (method === "sendAudio") payload.audio = fileId;
  else if (method === "sendVoice") payload.voice = fileId;
  else if (method === "sendAnimation") payload.animation = fileId;

  const res = await safeTgCall(() => tgRequest(method, payload, env));
  if (!res.ok && parseMode === "HTML" && isParseError(res.description)) {
    const plain = stripHtml(caption || "");
    delete payload.parse_mode;
    payload.caption = plain.substring(0, MAX_CAPTION_LEN);
    return safeTgCall(() => tgRequest(method, payload, env));
  }
  return res;
}

async function sendMediaGroup(chatId, files, caption, env, replyToMessageId) {
  const validTypes = ["photo", "video", "document", "audio"];
  const valid = files.filter(f => validTypes.includes(f.type));
  if (valid.length === 0) return { ok: false, error: "No valid media for album" };

  const chunks = [];
  for (let i = 0; i < valid.length; i += 10) chunks.push(valid.slice(i, i + 10));

  let lastRes = null;
  for (let i = 0; i < chunks.length; i++) {
    const media = chunks[i].map((f, idx) => {
      const item = { type: f.type, media: f.file_id };
      if (i === 0 && idx === 0 && caption) item.caption = caption.substring(0, MAX_CAPTION_LEN);
      return item;
    });
    const payload = { chat_id: chatId, media: media };
    if (i === 0 && replyToMessageId) payload.reply_to_message_id = replyToMessageId;
    if (i === 0 && caption) payload.parse_mode = "HTML";
    lastRes = await safeTgCall(() => tgRequest("sendMediaGroup", payload, env));
    if (!lastRes.ok && lastRes.error_code && isParseError(lastRes.description)) {
      // fallback: strip HTML
      if (media[0] && media[0].caption) media[0].caption = stripHtml(media[0].caption);
      delete payload.parse_mode;
      lastRes = await safeTgCall(() => tgRequest("sendMediaGroup", payload, env));
    }
    if (i < chunks.length - 1) await sleep(150);
  }
  return lastRes;
}

async function editMessageCaption(chatId, messageId, caption, replyMarkup, env) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    caption: (caption || "").substring(0, MAX_CAPTION_LEN),
    parse_mode: "HTML"
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const res = await tgRequest("editMessageCaption", payload, env);
  if (!res.ok && isParseError(res.description)) {
    delete payload.parse_mode;
    payload.caption = stripHtml(caption || "").substring(0, MAX_CAPTION_LEN);
    return tgRequest("editMessageCaption", payload, env);
  }
  return res;
}

async function editMessageText(chatId, messageId, text, replyMarkup, env) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "HTML"
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const res = await tgRequest("editMessageText", payload, env);
  if (!res.ok && isParseError(res.description)) {
    delete payload.parse_mode;
    payload.text = stripHtml(text);
    return tgRequest("editMessageText", payload, env);
  }
  return res;
}

async function answerCallbackQuery(callbackQueryId, text, env) {
  return tgRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || ""
  }, env);
}

async function getChatMember(chatId, userId, env) {
  return tgRequest("getChatMember", { chat_id: chatId, user_id: userId }, env);
}

// ============================================================
//  Database
// ============================================================

async function dbRun(env, sql, params) {
  let stmt = env.DB.prepare(sql);
  if (params && params.length > 0) stmt = stmt.bind(...params);
  return stmt.run();
}

async function dbAll(env, sql, params) {
  let stmt = env.DB.prepare(sql);
  if (params && params.length > 0) stmt = stmt.bind(...params);
  const res = await stmt.all();
  return (res && res.results) || [];
}

async function dbGet(env, sql, params) {
  try {
    let stmt = env.DB.prepare(sql);
    if (params && params.length > 0) stmt = stmt.bind(...params);
    return await stmt.first();
  } catch (e) {
    console.error("dbGet error", e);
    return null;
  }
}

async function ensureDb(env) {
  if (DB_READY) return;
  try {
    const check = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).first();

    if (!check) {
      await env.DB.batch([
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS users (" +
          "id TEXT PRIMARY KEY, role TEXT DEFAULT 'user', state TEXT DEFAULT 'idle', " +
          "signature TEXT DEFAULT '', signature_enabled INTEGER DEFAULT 0, " +
          "is_banned INTEGER DEFAULT 0, caption_mode TEXT DEFAULT 'auto', " +
          "hashtag_mode TEXT DEFAULT 'manual', pending_draft_id INTEGER, " +
          "state_updated_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        ),
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS channels (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, chat_id TEXT, " +
          "title TEXT, username TEXT, is_default INTEGER DEFAULT 0, " +
          "is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        ),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_channels_user ON channels(user_id)"),
                         env.DB.prepare(
                           "CREATE TABLE IF NOT EXISTS drafts (" +
                           "id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, media_type TEXT, " +
                           "message TEXT DEFAULT '', caption TEXT DEFAULT '', hashtags TEXT DEFAULT '', " +
                           "status TEXT DEFAULT 'draft', scheduled_at TEXT, published_at TEXT, " +
                           "deleted_at TEXT, original_message_id TEXT, preview_message_id TEXT, " +
                           "media_group_id TEXT, is_global INTEGER DEFAULT 0, " +
                           "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
                         ),
                         env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id)"),
                         env.DB.prepare(
                           "CREATE TABLE IF NOT EXISTS posts (" +
                           "id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, channel_id INTEGER, " +
                           "draft_id INTEGER, telegram_message_id TEXT, status TEXT DEFAULT 'success', " +
                           "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
                         ),
                         env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id)")
      ]);
    }

    const userCols = await dbAll(env, "PRAGMA table_info(users)");
    const userColNames = userCols.map(c => c.name);
    if (!userColNames.includes("caption_mode"))
      await dbRun(env, "ALTER TABLE users ADD COLUMN caption_mode TEXT DEFAULT 'auto'");
    if (!userColNames.includes("hashtag_mode"))
      await dbRun(env, "ALTER TABLE users ADD COLUMN hashtag_mode TEXT DEFAULT 'manual'");
    if (!userColNames.includes("pending_draft_id"))
      await dbRun(env, "ALTER TABLE users ADD COLUMN pending_draft_id INTEGER");
    if (!userColNames.includes("state_updated_at"))
      await dbRun(env, "ALTER TABLE users ADD COLUMN state_updated_at TEXT");

    const draftCols = await dbAll(env, "PRAGMA table_info(drafts)");
    const draftColNames = draftCols.map(c => c.name);
    if (!draftColNames.includes("original_message_id"))
      await dbRun(env, "ALTER TABLE drafts ADD COLUMN original_message_id TEXT");
    if (!draftColNames.includes("preview_message_id"))
      await dbRun(env, "ALTER TABLE drafts ADD COLUMN preview_message_id TEXT");
    if (!draftColNames.includes("media_group_id"))
      await dbRun(env, "ALTER TABLE drafts ADD COLUMN media_group_id TEXT");
    if (!draftColNames.includes("is_global"))
      await dbRun(env, "ALTER TABLE drafts ADD COLUMN is_global INTEGER DEFAULT 0");

    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_orig_msg ON drafts(original_message_id)");
    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_prev_msg ON drafts(preview_message_id)");
    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_media_group ON drafts(media_group_id)");
    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status)");
    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_channels_chat ON channels(chat_id)");

    DB_READY = true;
  } catch (e) {
    console.error("DB init error", e);
    throw new Error("Database initialization failed");
  }
}

async function getUser(env, id) {
  return await dbGet(env, "SELECT * FROM users WHERE id = ?", [id]);
}

async function createUser(env, id, role) {
  await dbRun(env, "INSERT OR IGNORE INTO users (id, role) VALUES (?, ?)", [id, role]);
}

async function updateUserState(env, id, state) {
  await dbRun(env,
              "UPDATE users SET state = ?, state_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              [state, id]);
}

// ============================================================
//  Draft parsing
// ============================================================

function parseDraftMessage(msgStr) {
  if (!msgStr) return { files: [], is_album: false, is_text_only: true };
  try {
    if (msgStr.startsWith("{")) return JSON.parse(msgStr);
  } catch (e) { }
  return { files: [{ type: "photo", file_id: msgStr }], is_album: false, is_text_only: false };
}

// ============================================================
//  Hashtag generation
// ============================================================

function cleanTextForHashtags(text) {
  if (!text) return "";
  text = text.replace(/https?:\/\/[^\s]+/gi, "");
  text = text.replace(/(^|\s)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/[^\s]*/g, "$1");
  text = text.replace(/@[\w\u0600-\u06FF]+/g, "");
  text = text.replace(/#[\w\u0600-\u06FF]+/g, "");
  text = text.replace(/^\s*[\r\n]/gm, "");
  return text.trim();
}

async function generateHashtags(text, env) {
  try {
    if (!env.AI) return "";
    const prompt =
    `Generate exactly 10 relevant hashtags in English for the given text. ` +
    `Output only hashtags separated by spaces in a single line. Each hashtag must start with '#'. ` +
    `No other text.\n\nText: "${text}"\nHashtags:`;
    const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8-fast", {
      prompt: prompt, temperature: 0.1, max_tokens: 200
    });
    let aiText = "";
    if (res) {
      if (typeof res.response === "string") aiText = res.response;
      else if (typeof res.result === "string") aiText = res.result;
      else if (res.response && typeof res.response === "object" && res.response.text)
        aiText = res.response.text;
    }
    if (aiText) {
      const words = aiText.match(/#[a-zA-Z0-9_]+/g);
      if (words && words.length > 0) {
        const unique = [...new Set(words)].slice(0, 10);
        return unique.join(" ");
      }
    }
  } catch (e) {
    console.error("AI error", e);
  }
  return "";
}

// ============================================================
//  Compose final caption (HTML)
// ============================================================

function composeCaption(caption, hashtags, signature, signatureEnabled) {
  const parts = [];
  if (caption) parts.push(caption);                // از قبل HTML است
  if (hashtags) parts.push(escapeHtml(hashtags));
  if (signature && signatureEnabled) parts.push(escapeAndLinkify(signature));
  return parts.join("\n\n");
}

// ============================================================
//  Keyboards
// ============================================================

function getMainKeyboard(role) {
  const keyboard = [
    [{ text: "➕ پست جدید" }, { text: "📡 کانال‌های من" }],
    [{ text: "➕ افزودن کانال" }, { text: "🗑 حذف کانال" }],
    [{ text: "✍️ امضا" }, { text: "📊 آمار" }, { text: "⚙️ تنظیمات" }]
  ];
  if (role === "owner") {
    keyboard.push([{ text: "👑 کاربران" }, { text: "📈 آمار کل" }]);
    keyboard.push([{ text: "🚫 مسدود کردن" }, { text: "📢 همگانی" }]);
    keyboard.push([{ text: "🌍 پست سراسری" }]);
  }
  return { keyboard: keyboard, resize_keyboard: true };
}

function getPreviewKeyboard(hasHashtags, isGlobal, draftId) {
  const buttons = [];
  if (isGlobal) {
    buttons.push([
      { text: "🚀 انتشار سراسری", callback_data: `gpub_${draftId}` },
      { text: "✏️ ویرایش کپشن", callback_data: `gedit_${draftId}` }
    ]);
    buttons.push([
      { text: "✨ تولید هشتگ", callback_data: `ggen_${draftId}` },
      { text: "❌ لغو", callback_data: `gcancel_${draftId}` }
    ]);
  } else {
    buttons.push([
      { text: "🚀 انتشار", callback_data: `pub_${draftId}` },
      { text: "✏️ ویرایش کپشن", callback_data: `edit_${draftId}` }
    ]);
    if (hasHashtags) {
      buttons.push([
        { text: "🔄 تولید مجدد", callback_data: `regen_${draftId}` },
        { text: "❌ حذف", callback_data: `rem_${draftId}` }
      ]);
    } else {
      buttons.push([{ text: "✨ تولید هشتگ", callback_data: `gen_${draftId}` }]);
    }
    buttons.push([{ text: "❌ لغو", callback_data: `cancel_${draftId}` }]);
  }
  return { inline_keyboard: buttons };
}

// ============================================================
//  Smart publish (split HTML-safe)
// ============================================================

async function sendMediaWithSmartCaption(chatId, msgData, finalCaption, replyMarkup, env) {
  const isAlbum = msgData.is_album;
  const files = msgData.files || [];

  // متن‌تنها
  if (msgData.is_text_only || files.length === 0) {
    const chunks = splitHtml(finalCaption || "بدون متن", MAX_TEXT_LEN);
    let firstRes = null;
    for (let i = 0; i < chunks.length; i++) {
      const r = await sendMessage(chatId, chunks[i],
                                  i === chunks.length - 1 ? replyMarkup : null, env, null, "HTML");
      if (i === 0) firstRes = r;
      if (i < chunks.length - 1) await sleep(80);
    }
    return firstRes;
  }

  // مدیا با کپشن کوتاه
  if ((finalCaption || "").length <= MAX_CAPTION_LEN) {
    if (isAlbum) return await sendMediaGroup(chatId, files, finalCaption, env);
    const f = files[0];
    return await sendMedia(chatId, f.type, f.file_id, finalCaption, replyMarkup, env, null, "HTML");
  }

  // مدیا با کپشن بلند → مدیا بدون کپشن، سپس کپشن به‌صورت پیام
  let mediaRes;
  if (isAlbum) mediaRes = await sendMediaGroup(chatId, files, null, env);
  else {
    const f = files[0];
    mediaRes = await sendMedia(chatId, f.type, f.file_id, null, null, env);
  }

  let replyToId = null;
  if (mediaRes && mediaRes.ok) {
    if (Array.isArray(mediaRes.result) && mediaRes.result[0])
      replyToId = mediaRes.result[0].message_id;
    else if (mediaRes.result && mediaRes.result.message_id)
      replyToId = mediaRes.result.message_id;
  }

  const chunks = splitHtml(finalCaption, MAX_TEXT_LEN);
  for (let i = 0; i < chunks.length; i++) {
    await sendMessage(chatId, chunks[i],
                      i === chunks.length - 1 ? replyMarkup : null,
                      env, i === 0 ? replyToId : null, "HTML");
    if (i < chunks.length - 1) await sleep(80);
  }
  return mediaRes;
}

// ============================================================
//  Preview
// ============================================================

async function sendPreview(env, user, draft, isGlobal) {
  const fullCaption = composeCaption(draft.caption, draft.hashtags, user.signature, user.signature_enabled);
  const finalCaption = previewCaption(fullCaption);
  const keyboard = getPreviewKeyboard(!!draft.hashtags, isGlobal, draft.id);
  const msgData = parseDraftMessage(draft.message);

  let res;
  if (msgData.is_album) {
    const text = `🖼 آلبوم دریافت شد (${msgData.files.length} فایل).\n\n${finalCaption}`;
    res = await sendMessage(user.id, text, keyboard, env, draft.original_message_id, "HTML");
  } else if (msgData.is_text_only || msgData.files.length === 0) {
    res = await sendMessage(user.id, finalCaption || "بدون متن", keyboard, env, draft.original_message_id, "HTML");
  } else {
    const file = msgData.files[0];
    res = await sendMedia(user.id, file.type, file.file_id, finalCaption, keyboard, env, draft.original_message_id, "HTML");
  }

  if (res && res.ok) {
    const previewId = res.result.message_id;
    msgData.preview_id = previewId;
    const updatedMsg = JSON.stringify(msgData);
    await dbRun(env, "UPDATE drafts SET message = ?, preview_message_id = ? WHERE id = ?",
                [updatedMsg, previewId, draft.id]);
    draft.message = updatedMsg;
    draft.preview_message_id = previewId;
    return true;
  }
  await sendMessage(user.id, "❌ خطا در ارسال پیش‌نمایش.", getMainKeyboard(user.role), env);
  return false;
}

async function editPreviewMessage(env, user, draft, isGlobal) {
  const fullCaption = composeCaption(draft.caption, draft.hashtags, user.signature, user.signature_enabled);
  const finalCaption = previewCaption(fullCaption);
  const keyboard = getPreviewKeyboard(!!draft.hashtags, isGlobal, draft.id);
  const msgData = parseDraftMessage(draft.message);

  if (!msgData.preview_id && draft.preview_message_id) {
    msgData.preview_id = parseInt(draft.preview_message_id, 10);
  }
  if (!msgData.preview_id) return await sendPreview(env, user, draft, isGlobal);

  try {
    let res;
    if (msgData.is_album || msgData.is_text_only || msgData.files.length === 0) {
      const text = msgData.is_album
      ? `🖼 آلبوم دریافت شد (${msgData.files.length} فایل).\n\n${finalCaption}`
      : (finalCaption || "بدون متن");
      res = await editMessageText(user.id, msgData.preview_id, text, keyboard, env);
    } else {
      res = await editMessageCaption(user.id, msgData.preview_id, finalCaption, keyboard, env);
    }
    if (res && res.ok) return res;

    if (res && (res.error_code === 400 || (res.description || "").includes("message to edit not found"))) {
      await dbRun(env, "UPDATE drafts SET preview_message_id = NULL WHERE id = ?", [draft.id]);
      msgData.preview_id = null;
      await dbRun(env, "UPDATE drafts SET message = ? WHERE id = ?", [JSON.stringify(msgData), draft.id]);
      draft.message = JSON.stringify(msgData);
      return await sendPreview(env, user, draft, isGlobal);
    }
    return res;
  } catch (e) {
    console.error("Edit preview error", e);
    return await sendPreview(env, user, draft, isGlobal);
  }
}

// ============================================================
//  Media detection
// ============================================================

function getMediaType(msg) {
  if (msg.photo && msg.photo.length > 0) return "photo";
  if (msg.video) return "video";
  if (msg.document) return "document";
  if (msg.audio) return "audio";
  if (msg.voice) return "voice";
  if (msg.animation) return "animation";
  return null;
}

function getFileId(msg, type) {
  if (!type) return null;
  if (type === "photo") return msg.photo[msg.photo.length - 1].file_id;
  return msg[type] ? msg[type].file_id : null;
}

// ============================================================
//  Publish
// ============================================================

async function publishDraft(env, user, draft) {
  const isGlobal = draft.is_global === 1 || draft.is_global === true;
  const channels = isGlobal
  ? await dbAll(env, "SELECT * FROM channels WHERE is_active = 1", [])
  : await dbAll(env, "SELECT * FROM channels WHERE user_id = ? AND is_active = 1", [user.id]);

  if (channels.length === 0) {
    await sendMessage(user.id,
                      isGlobal ? "❌ هیچ کانال فعالی در سطح کل وجود ندارد." : "❌ شما هیچ کانال فعالی ندارید.",
                      getMainKeyboard(user.role), env);
    await dbRun(env, "UPDATE drafts SET status = 'failed' WHERE id = ?", [draft.id]);
    return;
  }

  const msgData = parseDraftMessage(draft.message);
  const finalCaption = composeCaption(draft.caption, draft.hashtags, user.signature, user.signature_enabled);
  let successCount = 0;
  let failCount = 0;

  for (const ch of channels) {
    try {
      const res = await sendMediaWithSmartCaption(ch.chat_id, msgData, finalCaption, null, env);
      if (res && res.ok) {
        const tgMsgId = Array.isArray(res.result)
        ? (res.result[0] && res.result[0].message_id) || ""
        : (res.result && res.result.message_id) || "";
        await dbRun(env,
                    "INSERT INTO posts (user_id, channel_id, draft_id, telegram_message_id, status) VALUES (?, ?, ?, ?, ?)",
                    [user.id, ch.id, draft.id, tgMsgId.toString(), "success"]);
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      console.error("Publish error", e);
      failCount++;
    }
    await sleep(120);
  }

  const finalStatus = successCount > 0 ? "published" : "failed";
  await dbRun(env, "UPDATE drafts SET status = ?, published_at = CURRENT_TIMESTAMP WHERE id = ?",
              [finalStatus, draft.id]);

  let statusMsg = "";
  if (successCount > 0 && failCount === 0)
    statusMsg = `✅ ${isGlobal ? "سراسری " : ""}با موفقیت منتشر شد!\nتعداد: ${successCount}`;
  else if (successCount > 0 && failCount > 0)
    statusMsg = `⚠️ انتشار ناقص!\nموفق: ${successCount}\nناموفق: ${failCount}`;
  else
    statusMsg = `❌ انتشار ناموفق!\nناموفق: ${failCount}`;
  await sendMessage(user.id, statusMsg, getMainKeyboard(user.role), env);

  if (successCount > 0 && msgData.preview_id) {
    try {
      await tgRequest("deleteMessage", { chat_id: user.id, message_id: msgData.preview_id }, env);
    } catch (e) { }
  }
}

async function autoGenerateTags(env, user, draft, isGlobal) {
  try {
    const plain = stripHtml(draft.caption);
    const cleanText = cleanTextForHashtags(plain);
    if (!cleanText) return;
    const tags = await generateHashtags(cleanText, env);
    if (tags) {
      await dbRun(env, "UPDATE drafts SET hashtags = ? WHERE id = ?", [tags, draft.id]);
      const fresh = await dbGet(env, "SELECT * FROM drafts WHERE id = ?", [draft.id]);
      if (fresh) await editPreviewMessage(env, user, fresh, isGlobal);
    }
  } catch (e) {
    console.error("Auto tag gen error", e);
  }
}

// ============================================================
//  Message handler
// ============================================================

async function handleMessage(update, env, ctx) {
  const msg = update.message;
  if (!msg || !msg.from) return;
  if (msg.from.is_bot) return;

  const chatId = msg.from.id.toString();
  const ownerId = (env.OWNER_ID || "").toString();
  const role = chatId === ownerId ? "owner" : "user";

  let user = await getUser(env, chatId);
  if (!user) {
    await createUser(env, chatId, role);
    user = await getUser(env, chatId);
  }

  if (user.is_banned && chatId !== ownerId) {
    await sendMessage(chatId, "🚫 شما مسدود شده‌اید.", null, env);
    return;
  }

  // انقضای state
  if (user.state && user.state !== STATES.IDLE) {
    const updatedAt = parseSqliteUtc(user.state_updated_at);
    if (updatedAt && Date.now() - updatedAt > STATE_TTL_MS) {
      await updateUserState(env, chatId, STATES.IDLE);
      await dbRun(env, "UPDATE users SET pending_draft_id = NULL WHERE id = ?", [chatId]);
      user.state = STATES.IDLE;
      user.pending_draft_id = null;
    }
  }

  const rawText = msg.text || msg.caption || "";
  const cmdText = (msg.text || "").trim();
  const entities = msg.entities || msg.caption_entities || [];
  const state = user.state;

  if (Math.random() < 0.02) {
    ctx.waitUntil(
      dbRun(env,
            "UPDATE drafts SET status = 'expired' WHERE status = 'draft' AND created_at < datetime('now', '-24 hours')",
            [])
    );
  }

  if (cmdText === "/start") {
    await updateUserState(env, chatId, STATES.IDLE);
    await dbRun(env, "UPDATE users SET pending_draft_id = NULL WHERE id = ?", [chatId]);
    await sendMessage(chatId,
                      "👋 به ربات انتشار پست خوش آمدید!\nهر پیامی ارسال کنید به عنوان پست جدید ثبت می‌شود.\n\n" +
                      "دستورات:\n/start شروع مجدد\n/cancel لغو عملیات جاری",
                      getMainKeyboard(user.role), env);
    return;
  }

  if (cmdText === "/cancel") {
    await updateUserState(env, chatId, STATES.IDLE);
    await dbRun(env, "UPDATE users SET pending_draft_id = NULL WHERE id = ?", [chatId]);
    await sendMessage(chatId, "✅ عملیات لغو شد.", getMainKeyboard(user.role), env);
    return;
  }

  // ---- State handlers ----

  if (state === STATES.WAITING_BAN_USER && role === "owner") {
    const targetId = rawText.trim();
    const target = await getUser(env, targetId);
    if (target) {
      await dbRun(env, "UPDATE users SET is_banned = 1 WHERE id = ?", [targetId]);
      await sendMessage(chatId, `✅ کاربر ${targetId} مسدود شد.`, getMainKeyboard(user.role), env);
      try { await sendMessage(targetId, "🚫 شما مسدود شده‌اید.", null, env); } catch (e) { }
    } else {
      await sendMessage(chatId, "❌ کاربر یافت نشد.", getMainKeyboard(user.role), env);
    }
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (state === STATES.WAITING_BROADCAST && role === "owner") {
    const users = await dbAll(env, "SELECT id FROM users WHERE is_banned = 0", []);
    let sent = 0, failed = 0;
    for (const u of users) {
      const res = await sendMessage(u.id, `📢 پیام همگانی:\n\n${rawText}`, null, env);
      if (res && res.ok) sent++; else failed++;
      await sleep(60);
    }
    await sendMessage(chatId, `✅ پیام همگانی به ${sent} کاربر ارسال شد. ناموفق: ${failed}`,
                      getMainKeyboard(user.role), env);
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (state === STATES.WAITING_SIGNATURE) {
    if (cmdText === "/remove") {
      await dbRun(env, "UPDATE users SET signature = '', signature_enabled = 0 WHERE id = ?", [chatId]);
      await sendMessage(chatId, "✅ امضا حذف شد.", getMainKeyboard(user.role), env);
    } else {
      await dbRun(env, "UPDATE users SET signature = ?, signature_enabled = 1 WHERE id = ?",
                  [rawText, chatId]);
      await sendMessage(chatId, "✅ امضا ذخیره شد.", getMainKeyboard(user.role), env);
    }
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (state === STATES.WAITING_CAPTION_EDIT) {
    if (!rawText.trim()) {
      await sendMessage(chatId, "❌ لطفاً متن کپشن را ارسال کنید (یا /cancel).", null, env);
      return;
    }
    const target = await dbGet(env,
                               "SELECT * FROM drafts WHERE id = ? AND user_id = ? AND status = 'draft'",
                               [user.pending_draft_id, chatId]);
    if (!target) {
      await updateUserState(env, chatId, STATES.IDLE);
      await dbRun(env, "UPDATE users SET pending_draft_id = NULL WHERE id = ?", [chatId]);
      await sendMessage(chatId, "❌ پیش‌نویس یافت نشد یا منقضی شده است.", getMainKeyboard(user.role), env);
      return;
    }
    const newCaption = processUserText(rawText, entities, user.caption_mode);
    await dbRun(env, "UPDATE drafts SET caption = ? WHERE id = ?", [newCaption, target.id]);
    target.caption = newCaption;
    await editPreviewMessage(env, user, target, target.is_global === 1);
    await sendMessage(chatId, "✅ کپشن بروزرسانی شد.", null, env);
    await updateUserState(env, chatId, STATES.IDLE);
    await dbRun(env, "UPDATE users SET pending_draft_id = NULL WHERE id = ?", [chatId]);
    return;
  }

  if (state === STATES.WAITING_CHANNEL_FORWARD) {
    let fwdChat = null;
    if (msg.forward_origin && msg.forward_origin.type === "channel") {
      fwdChat = msg.forward_origin.chat;
    } else if (msg.forward_from_chat && msg.forward_from_chat.type === "channel") {
      fwdChat = msg.forward_from_chat;
    }
    if (!fwdChat) {
      await sendMessage(chatId, "❌ لطفاً یک پیام از کانال فوروارد کنید (نه از کاربر).",
                        getMainKeyboard(user.role), env);
      await updateUserState(env, chatId, STATES.IDLE);
      return;
    }
    const existing = await dbGet(env, "SELECT * FROM channels WHERE chat_id = ? AND user_id = ?",
                                 [fwdChat.id.toString(), chatId]);
    if (existing) {
      await sendMessage(chatId, "❌ این کانال قبلاً توسط شما ثبت شده است.",
                        getMainKeyboard(user.role), env);
      await updateUserState(env, chatId, STATES.IDLE);
      return;
    }

    let isUserAdmin = false, isBotAdmin = false;
    const member = await getChatMember(fwdChat.id, chatId, env);
    if (member && member.ok &&
      (member.result.status === "administrator" || member.result.status === "creator"))
      isUserAdmin = true;

    const me = await tgRequest("getMe", {}, env);
    if (me && me.ok) {
      const botMember = await getChatMember(fwdChat.id, me.result.id, env);
      if (botMember && botMember.ok &&
        (botMember.result.status === "administrator" || botMember.result.status === "creator"))
        isBotAdmin = true;
    }

    if (!isUserAdmin || !isBotAdmin) {
      await sendMessage(chatId, "❌ هم شما و هم ربات باید در کانال ادمین باشید.",
                        getMainKeyboard(user.role), env);
      await updateUserState(env, chatId, STATES.IDLE);
      return;
    }

    await dbRun(env,
                "INSERT INTO channels (user_id, chat_id, title, username) VALUES (?, ?, ?, ?)",
                [chatId, fwdChat.id.toString(), fwdChat.title || "", fwdChat.username || ""]);
    await sendMessage(chatId, "✅ کانال ثبت شد!", getMainKeyboard(user.role), env);
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (state === STATES.WAITING_DELETE_CHANNEL) {
    const channelId = rawText.trim();
    const channel = await dbGet(env, "SELECT * FROM channels WHERE id = ? AND user_id = ?",
                                [channelId, chatId]);
    if (channel) {
      await dbRun(env, "UPDATE channels SET is_active = 0 WHERE id = ?", [channelId]);
      await sendMessage(chatId, "✅ کانال حذف شد.", getMainKeyboard(user.role), env);
    } else {
      await sendMessage(chatId, "❌ کانال یافت نشد.", getMainKeyboard(user.role), env);
    }
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  // ریپلای روی پیش‌نمایش برای ویرایش کپشن
  if (msg.reply_to_message) {
    const repliedMsgId = msg.reply_to_message.message_id.toString();
    let draft = await dbGet(env,
                            "SELECT * FROM drafts WHERE preview_message_id = ? AND user_id = ? AND status = 'draft'",
                            [repliedMsgId, chatId]);
    if (!draft) {
      draft = await dbGet(env,
                          "SELECT * FROM drafts WHERE original_message_id = ? AND user_id = ? AND status = 'draft'",
                          [repliedMsgId, chatId]);
    }
    if (draft) {
      if (!rawText.trim()) {
        await sendMessage(chatId, "❌ کپشن نمی‌تواند خالی باشد.", null, env);
        return;
      }
      const newCaption = processUserText(rawText, entities, user.caption_mode);
      await dbRun(env, "UPDATE drafts SET caption = ? WHERE id = ?", [newCaption, draft.id]);
      draft.caption = newCaption;
      await editPreviewMessage(env, user, draft, draft.is_global === 1);
      await sendMessage(chatId, "✅ کپشن بروزرسانی شد.", null, env);
      return;
    }
    await sendMessage(chatId, "❌ برای ویرایش کپشن، از دکمه «✏️ ویرایش کپشن» استفاده کنید.",
                      null, env);
    return;
  }

  // ---- Main menu buttons (فقط از msg.text، نه caption) ----

  if (cmdText === "➕ پست جدید") {
    await sendMessage(chatId,
                      "📨 هرگونه متن، عکس، فیلم یا فوروارد را ارسال کنید تا پیش‌نویس آن ساخته شود.",
                      null, env);
    return;
  }

  if (cmdText === "⚙️ تنظیمات") {
    const settings_keyboard = {
      inline_keyboard: [[
        { text: `کپشن: ${user.caption_mode === "auto" ? "✅ خودکار" : "❌ دستی"}`, callback_data: "set_cap" },
        { text: `هشتگ: ${user.hashtag_mode === "auto" ? "✅ خودکار" : "❌ دستی"}`, callback_data: "set_tag" }
      ]]
    };
    await sendMessage(chatId, "⚙️ تنظیمات ربات:", settings_keyboard, env);
    return;
  }

  if (cmdText === "🌍 پست سراسری" && role === "owner") {
    await updateUserState(env, chatId, STATES.WAITING_GLOBAL_POST);
    await sendMessage(chatId, "🌍 پیام یا رسانه سراسری خود را ارسال کنید.", null, env);
    return;
  }

  if (cmdText === "📡 کانال‌های من") {
    const channels = await dbAll(env,
                                 "SELECT * FROM channels WHERE user_id = ? AND is_active = 1", [chatId]);
    if (channels.length === 0) {
      await sendMessage(chatId, "❌ هیچ کانالی وجود ندارد.", getMainKeyboard(user.role), env);
      return;
    }
    let msgText = "📡 کانال‌های شما:\n";
    for (const ch of channels) msgText += `\n- ${ch.title} (@${ch.username || ch.chat_id})`;
    await sendMessage(chatId, msgText, getMainKeyboard(user.role), env);
    return;
  }

  if (cmdText === "➕ افزودن کانال") {
    await updateUserState(env, chatId, STATES.WAITING_CHANNEL_FORWARD);
    await sendMessage(chatId, "↪️ پیامی از کانال خود فوروارد کنید.", null, env);
    return;
  }

  if (cmdText === "🗑 حذف کانال") {
    const channels = await dbAll(env,
                                 "SELECT * FROM channels WHERE user_id = ? AND is_active = 1", [chatId]);
    if (channels.length === 0) {
      await sendMessage(chatId, "❌ هیچ کانالی وجود ندارد.", getMainKeyboard(user.role), env);
      return;
    }
    let msgText = "🗑 شناسه کانال برای حذف را ارسال کنید:\n";
    for (const ch of channels) msgText += `\n${ch.id}: ${ch.title}`;
    await updateUserState(env, chatId, STATES.WAITING_DELETE_CHANNEL);
    await sendMessage(chatId, msgText, null, env);
    return;
  }

  if (cmdText === "✍️ امضا") {
    await updateUserState(env, chatId, STATES.WAITING_SIGNATURE);
    await sendMessage(chatId,
                      "✍️ امضای جدید خود را ارسال کنید یا /remove را برای حذف بزنید.", null, env);
    return;
  }

  if (cmdText === "📊 آمار") {
    const posts = await dbGet(env,
                              "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'success'", [chatId]);
    const today = new Date().toISOString().split("T")[0];
    const todayPosts = await dbGet(env,
                                   "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'success' AND DATE(created_at) = ?",
                                   [chatId, today]);
    const channels = await dbGet(env,
                                 "SELECT COUNT(*) as count FROM channels WHERE user_id = ? AND is_active = 1", [chatId]);
    await sendMessage(chatId,
                      `📊 آمار شما:\nکانال‌های فعال: ${channels.count || 0}\nکل پست‌های موفق: ${posts.count || 0}\nپست‌های امروز: ${todayPosts.count || 0}`,
                      getMainKeyboard(user.role), env);
    return;
  }

  if (cmdText === "👑 کاربران" && role === "owner") {
    const users = await dbAll(env,
                              "SELECT id, is_banned FROM users ORDER BY created_at DESC LIMIT 30", []);
    let msgText = "👑 ۳۰ کاربر اخیر:\n";
    for (const u of users) msgText += `\n${u.id} ${u.is_banned ? "(مسدود)" : ""}`;
    await sendMessage(chatId, msgText, getMainKeyboard(user.role), env);
    return;
  }

  if (cmdText === "📈 آمار کل" && role === "owner") {
    const uCount = await dbGet(env, "SELECT COUNT(*) as count FROM users", []);
    const bCount = await dbGet(env, "SELECT COUNT(*) as count FROM users WHERE is_banned = 1", []);
    const cCount = await dbGet(env, "SELECT COUNT(*) as count FROM channels WHERE is_active = 1", []);
    const pCount = await dbGet(env, "SELECT COUNT(*) as count FROM posts WHERE status = 'success'", []);
    await sendMessage(chatId,
                      `📈 آمار کل:\nکاربران: ${uCount.count}\nمسدود: ${bCount.count}\nکانال‌ها: ${cCount.count}\nپست‌ها: ${pCount.count}`,
                      getMainKeyboard(user.role), env);
    return;
  }

  if (cmdText === "🚫 مسدود کردن" && role === "owner") {
    await updateUserState(env, chatId, STATES.WAITING_BAN_USER);
    await sendMessage(chatId, "🚫 شناسه کاربر برای مسدود کردن را ارسال کنید.", null, env);
    return;
  }

  if (cmdText === "📢 همگانی" && role === "owner") {
    await updateUserState(env, chatId, STATES.WAITING_BROADCAST);
    await sendMessage(chatId, "📢 متن پیام همگانی را ارسال کنید.", null, env);
    return;
  }

  if (cmdText.startsWith("/")) {
    await sendMessage(chatId, "❓ دستور ناشناخته. برای راهنما /start را بزنید.",
                      getMainKeyboard(user.role), env);
    return;
  }

  // ---- ساخت پیش‌نویس جدید ----

  const isGlobal = (state === STATES.WAITING_GLOBAL_POST && role === "owner");
  if (isGlobal) await updateUserState(env, chatId, STATES.IDLE);

  const mediaType = getMediaType(msg);
  const draftCaption = processUserText(rawText, entities, user.caption_mode);

  // آلبوم
  if (msg.media_group_id) {
    if (!mediaType) return;
    const fileId = getFileId(msg, mediaType);
    if (!fileId) return;

    let draft = await dbGet(env,
                            "SELECT * FROM drafts WHERE media_group_id = ? AND user_id = ? AND status = 'draft'",
                            [msg.media_group_id, chatId]);

    if (draft) {
      const msgData = parseDraftMessage(draft.message);
      msgData.files.push({ type: mediaType, file_id: fileId });
      const updatedMsg = JSON.stringify(msgData);
      await dbRun(env, "UPDATE drafts SET message = ? WHERE id = ?", [updatedMsg, draft.id]);
      draft.message = updatedMsg;
      await editPreviewMessage(env, user, draft, isGlobal);
      return;
    }

    const files = [{ type: mediaType, file_id: fileId }];
    const msgStr = JSON.stringify({ files: files, is_album: true, is_text_only: false });

    const insertRes = await dbRun(env,
                                  "INSERT INTO drafts (user_id, media_type, message, caption, original_message_id, media_group_id, is_global, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')",
                                  [chatId, "album", msgStr, draftCaption, msg.message_id.toString(),
                                  msg.media_group_id, isGlobal ? 1 : 0]);
    const draftId = insertRes.meta.last_row_id;
    const newDraft = {
      id: draftId, caption: draftCaption, hashtags: "", message: msgStr,
      preview_message_id: null,
      original_message_id: msg.message_id.toString(),
      is_global: isGlobal ? 1 : 0
    };
    await sendPreview(env, user, newDraft, isGlobal);
    if (user.hashtag_mode === "auto" && newDraft.caption) {
      ctx.waitUntil(autoGenerateTags(env, user, newDraft, isGlobal));
    }
    return;
  }

  // پیام تکی
  const fileId = mediaType ? getFileId(msg, mediaType) : null;
  const files = fileId ? [{ type: mediaType, file_id: fileId }] : [];
  const isTextOnly = files.length === 0;
  const mediaTypeStr = mediaType || "text";
  const msgStr = JSON.stringify({ files: files, is_album: false, is_text_only: isTextOnly });

  const insertRes = await dbRun(env,
                                "INSERT INTO drafts (user_id, media_type, message, caption, original_message_id, is_global, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
                                [chatId, mediaTypeStr, msgStr, draftCaption, msg.message_id.toString(), isGlobal ? 1 : 0]);

  const draftId = insertRes.meta.last_row_id;
  const newDraft = {
    id: draftId, caption: draftCaption, hashtags: "", message: msgStr,
    preview_message_id: null,
    original_message_id: msg.message_id.toString(),
    is_global: isGlobal ? 1 : 0
  };

  await sendPreview(env, user, newDraft, isGlobal);
  if (user.hashtag_mode === "auto" && newDraft.caption) {
    ctx.waitUntil(autoGenerateTags(env, user, newDraft, isGlobal));
  }
}

// ============================================================
//  Callback handler
// ============================================================

async function handleCallback(update, env) {
  const cb = update.callback_query;
  if (!cb || !cb.from || !cb.message) return;

  const chatId = cb.from.id.toString();
  const ownerId = (env.OWNER_ID || "").toString();
  const role = chatId === ownerId ? "owner" : "user";

  let user = await getUser(env, chatId);
  if (!user) {
    await createUser(env, chatId, role);
    user = await getUser(env, chatId);
  }

  if (user.is_banned && chatId !== ownerId) {
    await answerCallbackQuery(cb.id, "🚫 شما مسدود شده‌اید.", env);
    return;
  }

  const data = cb.data;
  if (!data) {
    await answerCallbackQuery(cb.id, "❓ عملیات ناشناخته.", env);
    return;
  }

  if (data.startsWith("set_")) {
    const target = data.split("_")[1];
    if (target === "cap") {
      const newMode = user.caption_mode === "auto" ? "manual" : "auto";
      await dbRun(env, "UPDATE users SET caption_mode = ? WHERE id = ?", [newMode, chatId]);
      user.caption_mode = newMode;
    } else if (target === "tag") {
      const newMode = user.hashtag_mode === "auto" ? "manual" : "auto";
      await dbRun(env, "UPDATE users SET hashtag_mode = ? WHERE id = ?", [newMode, chatId]);
      user.hashtag_mode = newMode;
    }
    const settings_keyboard = {
      inline_keyboard: [[
        { text: `کپشن: ${user.caption_mode === "auto" ? "✅ خودکار" : "❌ دستی"}`, callback_data: "set_cap" },
        { text: `هشتگ: ${user.hashtag_mode === "auto" ? "✅ خودکار" : "❌ دستی"}`, callback_data: "set_tag" }
      ]]
    };
    await answerCallbackQuery(cb.id, "✅ تنظیمات بروزرسانی شد.", env);
    await tgRequest("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: cb.message.message_id,
      reply_markup: settings_keyboard
    }, env);
    return;
  }

  const parts = data.split("_");
  const action = parts[0];
  const draftId = parts[1];

  if (!draftId || isNaN(parseInt(draftId))) {
    await answerCallbackQuery(cb.id, "❓ عملیات نامعتبر.", env);
    return;
  }

  const isGlobalAction = action.startsWith("g");
  if (isGlobalAction && role !== "owner") {
    await answerCallbackQuery(cb.id, "❌ غیرمجاز.", env);
    return;
  }

  const draftRow = await dbGet(env, "SELECT * FROM drafts WHERE id = ? AND user_id = ?",
                               [draftId, chatId]);
  if (!draftRow || draftRow.status !== "draft") {
    await answerCallbackQuery(cb.id, "❌ پیش‌نویس یافت نشد یا منقضی شده است.", env);
    try { await tgRequest("deleteMessage", { chat_id: chatId, message_id: cb.message.message_id }, env); } catch (e) { }
    return;
  }

  const draft = { ...draftRow, is_global: draftRow.is_global === 1 };

  if (action === "gen" || action === "regen" || action === "ggen" || action === "gregen") {
    await answerCallbackQuery(cb.id, "✨ در حال تولید هشتگ...", env);
    const plain = stripHtml(draft.caption || "");
    const cleanText = cleanTextForHashtags(plain);
    if (cleanText) {
      const tags = await generateHashtags(cleanText, env);
      await dbRun(env, "UPDATE drafts SET hashtags = ? WHERE id = ?", [tags, draft.id]);
      draft.hashtags = tags;
      await editPreviewMessage(env, user, draft, draft.is_global);
    } else {
      await answerCallbackQuery(cb.id, "❌ متنی برای تولید هشتگ یافت نشد.", env);
    }
    return;
  }

  if (action === "rem" || action === "grem") {
    await dbRun(env, "UPDATE drafts SET hashtags = '' WHERE id = ?", [draft.id]);
    draft.hashtags = "";
    await editPreviewMessage(env, user, draft, draft.is_global);
    await answerCallbackQuery(cb.id, "✅ هشتگ‌ها حذف شدند.", env);
    return;
  }

  if (action === "edit" || action === "gedit") {
    await answerCallbackQuery(cb.id, "📝 کپشن جدید را ارسال کنید.", env);
    await dbRun(env, "UPDATE users SET pending_draft_id = ? WHERE id = ?", [draft.id, chatId]);
    await updateUserState(env, chatId, STATES.WAITING_CAPTION_EDIT);
    await sendMessage(chatId,
                      `📝 کپشن جدید پست #${draft.id} را ارسال کنید.\nبرای لغو /cancel را بزنید.`,
                      null, env);
    return;
  }

  if (action === "cancel" || action === "gcancel") {
    await answerCallbackQuery(cb.id, "", env);
    const updateRes = await dbRun(env,
                                  "UPDATE drafts SET status = 'cancelled', deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'",
                                  [draft.id]);
    if (updateRes.meta.changes === 0) {
      await sendMessage(chatId, "⚠️ این پست قبلاً لغو شده است.", null, env);
      return;
    }
    try {
      await tgRequest("deleteMessage",
                      { chat_id: chatId, message_id: cb.message.message_id }, env);
    } catch (e) { }
    const cancelMsg = action === "gcancel" ? "❌ پست سراسری لغو شد." : "❌ پست لغو شد.";
    await sendMessage(chatId, cancelMsg, getMainKeyboard(user.role), env);
    return;
  }

  if (action === "pub" || action === "gpub") {
    await answerCallbackQuery(cb.id, "🚀 در حال انتشار...", env);
    const updateRes = await dbRun(env,
                                  "UPDATE drafts SET status = 'publishing' WHERE id = ? AND status = 'draft'", [draftId]);
    if (updateRes.meta.changes === 0) {
      await sendMessage(chatId, "⚠️ این پست قبلاً منتشر یا لغو شده است.",
                        getMainKeyboard(user.role), env);
      try {
        await tgRequest("deleteMessage",
                        { chat_id: chatId, message_id: cb.message.message_id }, env);
      } catch (e) { }
      return;
    }
    const freshDraft = await dbGet(env, "SELECT * FROM drafts WHERE id = ?", [draftId]);
    if (!freshDraft) return;
    freshDraft.is_global = freshDraft.is_global === 1;
    await publishDraft(env, user, freshDraft);
    return;
  }

  await answerCallbackQuery(cb.id, "❓ عملیات ناشناخته.", env);
}

// ============================================================
//  Entry
// ============================================================

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!env.OWNER_ID) {
      console.warn("OWNER_ID is not configured — owner-only features are disabled.");
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("Bad Request", { status: 400 });
    }
    if (!update) return new Response("OK", { status: 200 });

    try {
      await ensureDb(env);
      if (update.message) {
        await handleMessage(update, env, ctx);
      } else if (update.callback_query) {
        await handleCallback(update, env);
      }
    } catch (e) {
      console.error("Unhandled error", e);
      return new Response("Internal Server Error", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  }
};
