const STATES = {
  IDLE: "idle",
  WAITING_CHANNEL_FORWARD: "waiting_channel_forward",
  WAITING_DELETE_CHANNEL: "waiting_delete_channel",
  WAITING_SIGNATURE: "waiting_signature",
  WAITING_BAN_USER: "waiting_ban_user",
  WAITING_UNBAN_USER: "waiting_unban_user",
  WAITING_BROADCAST: "waiting_broadcast",
  WAITING_GLOBAL_POST: "waiting_global_post"
};

const TG_API = "https://api.telegram.org/bot";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
      return { ok: false, error_code: data.error_code, description: data.description };
    }
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    console.error(`TG fetch error: ${e.message} for ${method}`);
    return { ok: false, error: e.message };
  }
}

async function sendMessage(chatId, text, replyMarkup, env, replyToMessageId) {
  const payload = { chat_id: chatId, text: text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  return tgRequest("sendMessage", payload, env);
}

async function sendMedia(chatId, mediaType, fileId, caption, replyMarkup, env, replyToMessageId) {
  const methodMap = {
    photo: "sendPhoto", video: "sendVideo", document: "sendDocument",
    audio: "sendAudio", voice: "sendVoice", animation: "sendAnimation"
  };
  const method = methodMap[mediaType];
  if (!method) return { ok: false, error: "Unsupported media type" };

  const payload = { chat_id: chatId };
  if (caption) payload.caption = caption;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;

  if (method === "sendPhoto") payload.photo = fileId;
  else if (method === "sendVideo") payload.video = fileId;
  else if (method === "sendDocument") payload.document = fileId;
  else if (method === "sendAudio") payload.audio = fileId;
  else if (method === "sendVoice") payload.voice = fileId;
  else if (method === "sendAnimation") payload.animation = fileId;

  return tgRequest(method, payload, env);
}

async function sendMediaGroup(chatId, files, caption, env, replyToMessageId) {
  const media = files.map((f, index) => {
    const item = { type: f.type, media: f.file_id };
    if (index === 0 && caption) item.caption = caption;
    return item;
  });
  const payload = { chat_id: chatId, media: media };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  return tgRequest("sendMediaGroup", payload, env);
}

async function editMessageCaption(chatId, messageId, caption, replyMarkup, env) {
  const payload = { chat_id: chatId, message_id: messageId };
  if (caption) payload.caption = caption;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgRequest("editMessageCaption", payload, env);
}

async function answerCallbackQuery(callbackQueryId, text, env) {
  return tgRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text || "" }, env);
}

async function getChatMember(chatId, userId, env) {
  return tgRequest("getChatMember", { chat_id: chatId, user_id: userId }, env);
}

async function dbRun(env, sql, params) {
  let stmt = env.DB.prepare(sql);
  if (params && params.length > 0) stmt = stmt.bind(...params);
  return stmt.run();
}

async function dbAll(env, sql, params) {
  let stmt = env.DB.prepare(sql);
  if (params && params.length > 0) stmt = stmt.bind(...params);
  const res = await stmt.all();
  return res.results || [];
}

async function dbGet(env, sql, params) {
  let stmt = env.DB.prepare(sql);
  if (params && params.length > 0) stmt = stmt.bind(...params);
  return stmt.first();
}

async function ensureDb(env) {
  try {
    const check = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();
    if (!check) {
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, role TEXT DEFAULT 'user', state TEXT DEFAULT 'idle', signature TEXT DEFAULT '', signature_enabled INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
                         env.DB.prepare("CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, chat_id TEXT, title TEXT, username TEXT, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
                         env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_channels_user ON channels(user_id)"),
                         env.DB.prepare("CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, media_type TEXT, message TEXT DEFAULT '', caption TEXT DEFAULT '', hashtags TEXT DEFAULT '', status TEXT DEFAULT 'draft', scheduled_at TEXT, published_at TEXT, deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
                         env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id)"),
                         env.DB.prepare("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, channel_id INTEGER, draft_id INTEGER, telegram_message_id TEXT, status TEXT DEFAULT 'success', created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
                         env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id)")
      ]);
    }

    const userCols = await dbAll(env, "PRAGMA table_info(users)");
    const userColNames = userCols.map(c => c.name);
    if (!userColNames.includes("caption_mode")) await dbRun(env, "ALTER TABLE users ADD COLUMN caption_mode TEXT DEFAULT 'auto'");
    if (!userColNames.includes("hashtag_mode")) await dbRun(env, "ALTER TABLE users ADD COLUMN hashtag_mode TEXT DEFAULT 'manual'");

    const draftCols = await dbAll(env, "PRAGMA table_info(drafts)");
    const draftColNames = draftCols.map(c => c.name);
    if (!draftColNames.includes("original_message_id")) await dbRun(env, "ALTER TABLE drafts ADD COLUMN original_message_id TEXT");
    if (!draftColNames.includes("preview_message_id")) await dbRun(env, "ALTER TABLE drafts ADD COLUMN preview_message_id TEXT");
    if (!draftColNames.includes("media_group_id")) await dbRun(env, "ALTER TABLE drafts ADD COLUMN media_group_id TEXT");
    if (!draftColNames.includes("is_global")) await dbRun(env, "ALTER TABLE drafts ADD COLUMN is_global INTEGER DEFAULT 0");

    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_orig_msg ON drafts(original_message_id)");
    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_prev_msg ON drafts(preview_message_id)");
    await dbRun(env, "CREATE INDEX IF NOT EXISTS idx_drafts_media_group ON drafts(media_group_id)");

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
  await dbRun(env, "UPDATE users SET state = ? WHERE id = ?", [state, id]);
}

function parseDraftMessage(msgStr) {
  if (!msgStr) return { files: [], is_album: false, is_text_only: true };
  try {
    if (msgStr.startsWith("{")) return JSON.parse(msgStr);
  } catch (e) { }
  return { files: [{ type: 'photo', file_id: msgStr }], is_album: false, is_text_only: false };
}

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
    buttons.push([{ text: "❌ لغو", callback_data: `gcancel_${draftId}` }]);
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

function cleanCaption(text) {
  if (!text) return "";
  text = text.replace(/#[\w\u0600-\u06FF]+/g, "");
  text = text.replace(/@[\w\u0600-\u06FF]+/g, "");
  text = text.replace(/https?:\/\/(t\.me|telegram\.me|telegram\.dog)\/[^\s]+/gi, "");
  text = text.replace(/(^|\s)(t\.me|telegram\.me|telegram\.dog)\/[^\s]+/gi, "$1");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

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
    const prompt = `Generate exactly 10 relevant hashtags in English for the given text. Output only hashtags separated by spaces in a single line. Each hashtag must start with '#'. No other text.\n\nText: "${text}"\nHashtags:`;
    const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8-fast", {
      prompt: prompt, temperature: 0.1, max_tokens: 200
    });
    let aiText = "";
    if (res) {
      if (typeof res.response === "string") aiText = res.response;
      else if (typeof res.result === "string") aiText = res.result;
      else if (res.response && typeof res.response === "object" && res.response.text) aiText = res.response.text;
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

function composeCaption(caption, hashtags, signature, signatureEnabled) {
  let parts = [];
  if (caption) parts.push(caption.trim());
  if (hashtags) parts.push(hashtags.trim());
  if (signature && signatureEnabled) parts.push(signature.trim());
  return parts.join("\n\n");
}

async function sendPreview(env, user, draft, isGlobal) {
  const finalCaption = composeCaption(draft.caption, draft.hashtags, user.signature, user.signature_enabled);
  const keyboard = getPreviewKeyboard(!!draft.hashtags, isGlobal, draft.id);
  const msgData = parseDraftMessage(draft.message);

  let res;
  if (msgData.is_album) {
    const text = `🖼 آلبوم دریافت شد (${msgData.files.length} فایل).\n\n${finalCaption}`;
    res = await sendMessage(user.id, text, keyboard, env, draft.original_message_id);
  } else if (msgData.is_text_only || msgData.files.length === 0) {
    res = await sendMessage(user.id, finalCaption || "بدون متن", keyboard, env, draft.original_message_id);
  } else {
    const file = msgData.files[0];
    res = await sendMedia(user.id, file.type, file.file_id, finalCaption, keyboard, env, draft.original_message_id);
  }

  if (res && res.ok) {
    msgData.preview_id = res.result.message_id;
    await dbRun(env, "UPDATE drafts SET message = ?, preview_message_id = ? WHERE id = ?", [JSON.stringify(msgData), res.result.message_id, draft.id]);
    return true;
  } else {
    await sendMessage(user.id, "❌ خطا در ارسال پیش‌نمایش.", getMainKeyboard(user.role), env);
    return false;
  }
}

async function editPreviewMessage(env, user, draft, isGlobal) {
  const finalCaption = composeCaption(draft.caption, draft.hashtags, user.signature, user.signature_enabled);
  const keyboard = getPreviewKeyboard(!!draft.hashtags, isGlobal, draft.id);
  const msgData = parseDraftMessage(draft.message);

  if (!msgData.preview_id) return await sendPreview(env, user, draft, isGlobal);

  try {
    if (msgData.is_album || msgData.is_text_only || msgData.files.length === 0) {
      const text = msgData.is_album ? `🖼 آلبوم دریافت شد (${msgData.files.length} فایل).\n\n${finalCaption}` : (finalCaption || "بدون متن");
      return await tgRequest("editMessageText", { chat_id: user.id, message_id: msgData.preview_id, text: text, reply_markup: keyboard }, env);
    } else {
      return await editMessageCaption(user.id, msgData.preview_id, finalCaption, keyboard, env);
    }
  } catch (e) {
    console.error("Edit preview error", e);
    return await sendPreview(env, user, draft, isGlobal);
  }
}

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
  if (type === "photo") return msg.photo[msg.photo.length - 1].file_id;
  return msg[type] ? msg[type].file_id : null;
}

async function publishDraft(env, user, draft) {
  const isGlobal = draft.is_global === 1;
  const channels = isGlobal ? await dbAll(env, "SELECT * FROM channels WHERE is_active = 1", []) : await dbAll(env, "SELECT * FROM channels WHERE user_id = ? AND is_active = 1", [user.id]);

  if (channels.length === 0) {
    await sendMessage(user.id, isGlobal ? "❌ هیچ کانال فعالی در سطح کل وجود ندارد." : "❌ شما هیچ کانال فعالی ندارید.", getMainKeyboard(user.role), env);
    await dbRun(env, "UPDATE drafts SET status = 'failed' WHERE id = ?", [draft.id]);
    return;
  }

  const msgData = parseDraftMessage(draft.message);
  const finalCaption = composeCaption(draft.caption, draft.hashtags, user.signature, user.signature_enabled);
  let successCount = 0;
  let failCount = 0;

  for (const ch of channels) {
    try {
      let res;
      if (msgData.is_album) {
        res = await sendMediaGroup(ch.chat_id, msgData.files, finalCaption, env);
      } else if (msgData.is_text_only || msgData.files.length === 0) {
        res = await sendMessage(ch.chat_id, finalCaption || "بدون متن", null, env);
      } else {
        const file = msgData.files[0];
        res = await sendMedia(ch.chat_id, file.type, file.file_id, finalCaption, null, env);
      }

      if (res && res.ok) {
        await dbRun(env, "INSERT INTO posts (user_id, channel_id, draft_id, telegram_message_id, status) VALUES (?, ?, ?, ?, ?)",
                    [user.id, ch.id, draft.id, (res.result.message_id || "").toString(), "success"]);
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      console.error("Publish error", e);
      failCount++;
    }
    await sleep(50);
  }

  const finalStatus = (successCount > 0) ? 'published' : 'failed';
  await dbRun(env, "UPDATE drafts SET status = ?, published_at = CURRENT_TIMESTAMP WHERE id = ?", [finalStatus, draft.id]);

  let statusMsg = "";
  if (successCount > 0 && failCount === 0) {
    statusMsg = `✅ ${isGlobal ? 'سراسری ' : ''}با موفقیت منتشر شد!\nتعداد: ${successCount}`;
  } else if (successCount > 0 && failCount > 0) {
    statusMsg = `⚠️ انتشار ناقص!\nموفق: ${successCount}\nناموفق: ${failCount}`;
  } else {
    statusMsg = `❌ انتشار ناموفق!\nناموفق: ${failCount}`;
  }
  await sendMessage(user.id, statusMsg, getMainKeyboard(user.role), env);

  if (msgData.preview_id) {
    await tgRequest("deleteMessage", { chat_id: user.id, message_id: msgData.preview_id }, env);
  }
}

async function autoGenerateTags(env, user, draft, isGlobal) {
  try {
    const cleanText = cleanTextForHashtags(draft.caption);
    if (!cleanText) return;
    const tags = await generateHashtags(cleanText, env);
    if (tags) {
      await dbRun(env, "UPDATE drafts SET hashtags = ? WHERE id = ?", [tags, draft.id]);
      draft.hashtags = tags;
      await editPreviewMessage(env, user, draft, isGlobal);
    }
  } catch (e) {
    console.error("Auto tag gen error", e);
  }
}

async function handleMessage(update, env, ctx) {
  const msg = update.message;
  if (!msg || !msg.from) return;
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

  const rawText = msg.text || msg.caption || "";
  const text = rawText.trim();
  const state = user.state;

  if (Math.random() < 0.05) {
    ctx.waitUntil(dbRun(env, "UPDATE drafts SET status = 'expired' WHERE status = 'draft' AND created_at < datetime('now', '-24 hours')"));
  }

  if (text === "/start") {
    await updateUserState(env, chatId, STATES.IDLE);
    await sendMessage(chatId, "👋 به ربات انتشار پست خوش آمدید!\nهر پیامی ارسال کنید به عنوان پست جدید ثبت می‌شود.", getMainKeyboard(user.role), env);
    return;
  }

  if (state === STATES.WAITING_BAN_USER && role === "owner") {
    const targetId = text.trim();
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
    let sent = 0; let failed = 0;
    for (const u of users) {
      try {
        const res = await sendMessage(u.id, `📢 پیام همگانی:\n\n${rawText}`, null, env);
        if (res && res.ok) sent++; else failed++;
        await sleep(50);
      } catch (e) { failed++; }
    }
    await sendMessage(chatId, `✅ پیام همگانی به ${sent} کاربر ارسال شد. ناموفق: ${failed}`, getMainKeyboard(user.role), env);
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (state === STATES.WAITING_SIGNATURE) {
    if (rawText === "/remove") {
      await dbRun(env, "UPDATE users SET signature = '', signature_enabled = 0 WHERE id = ?", [chatId]);
      await sendMessage(chatId, "✅ امضا حذف شد.", getMainKeyboard(user.role), env);
    } else {
      await dbRun(env, "UPDATE users SET signature = ?, signature_enabled = 1 WHERE id = ?", [rawText, chatId]);
      await sendMessage(chatId, "✅ امضا ذخیره شد.", getMainKeyboard(user.role), env);
    }
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (state === STATES.WAITING_CHANNEL_FORWARD) {
    if (msg.forward_from_chat) {
      const chat = msg.forward_from_chat;
      if (chat.type !== "channel") {
        await sendMessage(chatId, "❌ لطفاً یک پیام از کانال فوروارد کنید.", getMainKeyboard(user.role), env);
        await updateUserState(env, chatId, STATES.IDLE);
        return;
      }
      const existing = await dbGet(env, "SELECT * FROM channels WHERE chat_id = ? AND user_id = ?", [chat.id.toString(), chatId]);
      if (existing) {
        await sendMessage(chatId, "❌ این کانال قبلاً توسط شما ثبت شده است.", getMainKeyboard(user.role), env);
        await updateUserState(env, chatId, STATES.IDLE);
        return;
      }
      let isUserAdmin = false; let isBotAdmin = false;
      try {
        const member = await getChatMember(chat.id, chatId, env);
        if (member && member.ok && (member.result.status === "administrator" || member.result.status === "creator")) isUserAdmin = true;
      } catch (e) { }
      try {
        const me = await tgRequest("getMe", {}, env);
        if (me && me.ok) {
          const botMember = await getChatMember(chat.id, me.result.id, env);
          if (botMember && botMember.ok && (botMember.result.status === "administrator" || botMember.result.status === "creator")) isBotAdmin = true;
        }
      } catch (e) { }
      if (!isUserAdmin || !isBotAdmin) {
        await sendMessage(chatId, "❌ هم شما و هم ربات باید در کانال ادمین باشید.", getMainKeyboard(user.role), env);
        await updateUserState(env, chatId, STATES.IDLE);
        return;
      }
      await dbRun(env, "INSERT INTO channels (user_id, chat_id, title, username) VALUES (?, ?, ?, ?)",
                  [chatId, chat.id.toString(), chat.title || "", chat.username || ""]);
      await sendMessage(chatId, "✅ کانال ثبت شد!", getMainKeyboard(user.role), env);
      await updateUserState(env, chatId, STATES.IDLE);
    } else {
      await sendMessage(chatId, "❌ لطفاً یک پیام از کانال فوروارد کنید.", getMainKeyboard(user.role), env);
      await updateUserState(env, chatId, STATES.IDLE);
    }
    return;
  }

  if (state === STATES.WAITING_DELETE_CHANNEL) {
    const channelId = text.trim();
    const channel = await dbGet(env, "SELECT * FROM channels WHERE id = ? AND user_id = ?", [channelId, chatId]);
    if (channel) {
      await dbRun(env, "UPDATE channels SET is_active = 0 WHERE id = ?", [channelId]);
      await sendMessage(chatId, "✅ کانال حذف شد.", getMainKeyboard(user.role), env);
    } else {
      await sendMessage(chatId, "❌ کانال یافت نشد.", getMainKeyboard(user.role), env);
    }
    await updateUserState(env, chatId, STATES.IDLE);
    return;
  }

  if (msg.reply_to_message) {
    const repliedMsgId = msg.reply_to_message.message_id.toString();
    let draft = await dbGet(env, "SELECT * FROM drafts WHERE preview_message_id = ? AND user_id = ? AND status = 'draft'", [repliedMsgId, chatId]);
    if (!draft) {
      draft = await dbGet(env, "SELECT * FROM drafts WHERE original_message_id = ? AND user_id = ? AND status = 'draft'", [repliedMsgId, chatId]);
    }
    if (draft) {
      const newCaption = user.caption_mode === 'auto' ? cleanCaption(rawText) : rawText;
      await dbRun(env, "UPDATE drafts SET caption = ? WHERE id = ?", [newCaption, draft.id]);
      draft.caption = newCaption;
      await editPreviewMessage(env, user, draft, draft.is_global === 1);
      await sendMessage(chatId, "✅ کپشن بروزرسانی شد.", null, env);
      return;
    }
  }

  if (text === "➕ پست جدید") {
    await sendMessage(chatId, "📨 هرگونه متن، عکس، فیلم یا فوروارد را ارسال کنید تا پیش‌نویس آن ساخته شود.", null, env);
    return;
  }

  if (text === "⚙️ تنظیمات") {
    const settings_keyboard = {
      inline_keyboard: [
        [
          { text: `کپشن: ${user.caption_mode === 'auto' ? '✅ خودکار' : '❌ دستی'}`, callback_data: "set_cap" },
          { text: `هشتگ: ${user.hashtag_mode === 'auto' ? '✅ خودکار' : '❌ دستی'}`, callback_data: "set_tag" }
        ]
      ]
    };
    await sendMessage(chatId, "⚙️ تنظیمات ربات:", settings_keyboard, env);
    return;
  }

  if (text === "🌍 پست سراسری" && role === "owner") {
    await updateUserState(env, chatId, STATES.WAITING_GLOBAL_POST);
    await sendMessage(chatId, "🌍 پیام یا رسانه سراسری خود را ارسال کنید.", null, env);
    return;
  }

  if (text === "📡 کانال‌های من") {
    const channels = await dbAll(env, "SELECT * FROM channels WHERE user_id = ? AND is_active = 1", [chatId]);
    if (channels.length === 0) {
      await sendMessage(chatId, "❌ هیچ کانالی وجود ندارد.", getMainKeyboard(user.role), env); return;
    }
    let msgText = "📡 کانال‌های شما:\n";
    for (const ch of channels) msgText += `\n- ${ch.title} (@${ch.username || ch.chat_id})`;
    await sendMessage(chatId, msgText, getMainKeyboard(user.role), env);
    return;
  }

  if (text === "➕ افزودن کانال") {
    await updateUserState(env, chatId, STATES.WAITING_CHANNEL_FORWARD);
    await sendMessage(chatId, "↪️ پیامی از کانال خود فوروارد کنید.", null, env); return;
  }

  if (text === "🗑 حذف کانال") {
    const channels = await dbAll(env, "SELECT * FROM channels WHERE user_id = ? AND is_active = 1", [chatId]);
    if (channels.length === 0) {
      await sendMessage(chatId, "❌ هیچ کانالی وجود ندارد.", getMainKeyboard(user.role), env); return;
    }
    let msgText = "🗑 شناسه کانال برای حذف را ارسال کنید:\n";
    for (const ch of channels) msgText += `\n${ch.id}: ${ch.title}`;
    await updateUserState(env, chatId, STATES.WAITING_DELETE_CHANNEL);
    await sendMessage(chatId, msgText, null, env); return;
  }

  if (text === "✍️ امضا") {
    await updateUserState(env, chatId, STATES.WAITING_SIGNATURE);
    await sendMessage(chatId, "✍️ امضای جدید خود را ارسال کنید یا /remove را برای حذف بزنید.", null, env); return;
  }

  if (text === "📊 آمار") {
    const posts = await dbGet(env, "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'success'", [chatId]);
    const today = new Date().toISOString().split('T')[0];
    const todayPosts = await dbGet(env, "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'success' AND DATE(created_at) = ?", [chatId, today]);
    const channels = await dbGet(env, "SELECT COUNT(*) as count FROM channels WHERE user_id = ? AND is_active = 1", [chatId]);
    await sendMessage(chatId, `📊 آمار شما:\nکانال‌های فعال: ${channels.count || 0}\nکل پست‌های موفق: ${posts.count || 0}\nپست‌های امروز: ${todayPosts.count || 0}`, getMainKeyboard(user.role), env);
    return;
  }

  if (text === "👑 کاربران" && role === "owner") {
    const users = await dbAll(env, "SELECT id, is_banned FROM users ORDER BY created_at DESC LIMIT 30", []);
    let msgText = "👑 ۳۰ کاربر اخیر:\n";
    for (const u of users) msgText += `\n${u.id} ${u.is_banned ? "(مسدود)" : ""}`;
    await sendMessage(chatId, msgText, getMainKeyboard(user.role), env); return;
  }

  if (text === "📈 آمار کل" && role === "owner") {
    const uCount = await dbGet(env, "SELECT COUNT(*) as count FROM users", []);
    const bCount = await dbGet(env, "SELECT COUNT(*) as count FROM users WHERE is_banned = 1", []);
    const cCount = await dbGet(env, "SELECT COUNT(*) as count FROM channels WHERE is_active = 1", []);
    const pCount = await dbGet(env, "SELECT COUNT(*) as count FROM posts WHERE status = 'success'", []);
    await sendMessage(chatId, `📈 آمار کل:\nکاربران: ${uCount.count}\nمسدود: ${bCount.count}\nکانال‌ها: ${cCount.count}\nپست‌ها: ${pCount.count}`, getMainKeyboard(user.role), env);
    return;
  }

  if (text === "🚫 مسدود کردن" && role === "owner") {
    await updateUserState(env, chatId, STATES.WAITING_BAN_USER);
    await sendMessage(chatId, "🚫 شناسه کاربر برای مسدود کردن را ارسال کنید.", null, env); return;
  }

  if (text === "📢 همگانی" && role === "owner") {
    await updateUserState(env, chatId, STATES.WAITING_BROADCAST);
    await sendMessage(chatId, "📢 متن پیام همگانی را ارسال کنید.", null, env); return;
  }

  if (text.startsWith("/")) {
    await sendMessage(chatId, "❓ دستور ناشناخته.", getMainKeyboard(user.role), env);
    return;
  }

  const isGlobal = (state === STATES.WAITING_GLOBAL_POST && role === "owner");
  if (isGlobal) await updateUserState(env, chatId, STATES.IDLE);

  const mediaType = getMediaType(msg);

  if (msg.media_group_id) {
    let draft = await dbGet(env, "SELECT * FROM drafts WHERE media_group_id = ? AND user_id = ? AND status = 'draft'", [msg.media_group_id, chatId]);
    if (draft) {
      const msgData = parseDraftMessage(draft.message);
      msgData.files.push({ type: mediaType, file_id: getFileId(msg, mediaType) });
      await dbRun(env, "UPDATE drafts SET message = ? WHERE id = ?", [JSON.stringify(msgData), draft.id]);
      draft.message = JSON.stringify(msgData);
      await editPreviewMessage(env, user, draft, isGlobal);
      return;
    } else {
      const files = [{ type: mediaType, file_id: getFileId(msg, mediaType) }];
      const draftCaption = user.caption_mode === 'auto' ? cleanCaption(rawText) : rawText;
      const insertRes = await dbRun(env, "INSERT INTO drafts (user_id, media_type, message, caption, original_message_id, media_group_id, is_global, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')",
                                    [chatId, 'album', JSON.stringify({ files: files, is_album: true, is_text_only: false }), draftCaption, msg.message_id.toString(), msg.media_group_id, isGlobal ? 1 : 0]);
      const draftId = insertRes.meta.last_row_id;
      const draft = { id: draftId, caption: draftCaption, hashtags: "", message: JSON.stringify({ files, is_album: true, is_text_only: false }), original_message_id: msg.message_id.toString(), is_global: isGlobal ? 1 : 0 };
      await sendPreview(env, user, draft, isGlobal);
      if (user.hashtag_mode === 'auto' && draft.caption) {
        ctx.waitUntil(autoGenerateTags(env, user, draft, isGlobal));
      }
      return;
    }
  }

  const files = mediaType ? [{ type: mediaType, file_id: getFileId(msg, mediaType) }] : [];
  const isTextOnly = files.length === 0;
  const mediaTypeStr = mediaType || 'text';
  const draftCaption = user.caption_mode === 'auto' ? cleanCaption(rawText) : rawText;

  const insertRes = await dbRun(env, "INSERT INTO drafts (user_id, media_type, message, caption, original_message_id, is_global, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
                                [chatId, mediaTypeStr, JSON.stringify({ files: files, is_album: false, is_text_only: isTextOnly }), draftCaption, msg.message_id.toString(), isGlobal ? 1 : 0]);

  const draftId = insertRes.meta.last_row_id;
  const draft = { id: draftId, caption: draftCaption, hashtags: "", message: JSON.stringify({ files, is_album: false, is_text_only: isTextOnly }), original_message_id: msg.message_id.toString(), is_global: isGlobal ? 1 : 0 };

  await sendPreview(env, user, draft, isGlobal);

  if (user.hashtag_mode === 'auto' && draft.caption) {
    ctx.waitUntil(autoGenerateTags(env, user, draft, isGlobal));
  }
}

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
  if (!data || !data.includes("_")) {
    await answerCallbackQuery(cb.id, "❓ عملیات ناشناخته.", env);
    return;
  }

  if (data.startsWith("set_")) {
    const target = data.split("_")[1];
    if (target === "cap") {
      const newMode = user.caption_mode === 'auto' ? 'manual' : 'auto';
      await dbRun(env, "UPDATE users SET caption_mode = ? WHERE id = ?", [newMode, chatId]);
      user.caption_mode = newMode;
    } else if (target === "tag") {
      const newMode = user.hashtag_mode === 'auto' ? 'manual' : 'auto';
      await dbRun(env, "UPDATE users SET hashtag_mode = ? WHERE id = ?", [newMode, chatId]);
      user.hashtag_mode = newMode;
    }
    const settings_keyboard = {
      inline_keyboard: [
        [
          { text: `کپشن: ${user.caption_mode === 'auto' ? '✅ خودکار' : '❌ دستی'}`, callback_data: "set_cap" },
          { text: `هشتگ: ${user.hashtag_mode === 'auto' ? '✅ خودکار' : '❌ دستی'}`, callback_data: "set_tag" }
        ]
      ]
    };
    await tgRequest("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: settings_keyboard }, env);
    await answerCallbackQuery(cb.id, "✅ تنظیمات بروزرسانی شد.", env);
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

  const draftRow = await dbGet(env, "SELECT * FROM drafts WHERE id = ? AND user_id = ?", [draftId, chatId]);
  if (!draftRow || draftRow.status !== 'draft') {
    await answerCallbackQuery(cb.id, "❌ پیش‌نویس یافت نشد یا منقضی شده است.", env);
    if (cb.message) await tgRequest("deleteMessage", { chat_id: chatId, message_id: cb.message.message_id }, env);
    return;
  }

  const msgData = parseDraftMessage(draftRow.message);
  const draft = { ...draftRow, is_global: draftRow.is_global === 1 };

  if (action === "gen" || action === "regen") {
    await answerCallbackQuery(cb.id, "✨ در حال تولید هشتگ...", env);
    const cleanText = cleanTextForHashtags(draft.caption || "");
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

  if (action === "rem") {
    await dbRun(env, "UPDATE drafts SET hashtags = '' WHERE id = ?", [draft.id]);
    draft.hashtags = "";
    await editPreviewMessage(env, user, draft, draft.is_global);
    await answerCallbackQuery(cb.id, "✅ هشتگ‌ها حذف شدند.", env);
    return;
  }

  if (action === "edit" || action === "gedit") {
    await sendMessage(chatId, "📝 لطفاً کپشن جدید را روی همین پیامِ پیش‌نمایش ریپلای کنید.", null, env);
    await answerCallbackQuery(cb.id, "", env);
    return;
  }

  if (action === "cancel" || action === "gcancel") {
    const updateRes = await dbRun(env, "UPDATE drafts SET status = 'cancelled', deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'", [draft.id]);
    if (updateRes.meta.changes === 0) {
      await answerCallbackQuery(cb.id, "⚠️ این پست قبلاً لغو شده است.", env);
      return;
    }
    if (cb.message) {
      await tgRequest("deleteMessage", { chat_id: chatId, message_id: cb.message.message_id }, env);
    }
    const cancelMsg = action === "gcancel" ? "❌ پست سراسری لغو شد." : "❌ پست لغو شد.";
    await sendMessage(chatId, cancelMsg, getMainKeyboard(user.role), env);
    await answerCallbackQuery(cb.id, "", env);
    return;
  }

  if (action === "pub" || action === "gpub") {
    await answerCallbackQuery(cb.id, "🚀 در حال انتشار...", env);
    const updateRes = await dbRun(env, "UPDATE drafts SET status = 'publishing' WHERE id = ? AND status = 'draft'", [draftId]);
    if (updateRes.meta.changes === 0) {
      await sendMessage(chatId, "⚠️ این پست قبلاً منتشر یا لغو شده است.", getMainKeyboard(user.role), env);
      if (cb.message) await tgRequest("deleteMessage", { chat_id: chatId, message_id: cb.message.message_id }, env);
      return;
    }
    const freshDraft = await dbGet(env, "SELECT * FROM drafts WHERE id = ?", [draftId]);
    if (!freshDraft) return;
    draft.is_global = freshDraft.is_global === 1;
    await publishDraft(env, user, draft);
    return;
  }

  await answerCallbackQuery(cb.id, "❓ عملیات ناشناخته.", env);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
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
