# Telegram Channel Publisher

> A lightweight Telegram channel publishing bot built with Cloudflare Workers.

## فارسی 🇮🇷

**Telegram Channel Publisher** یک ربات سبک برای مدیریت و انتشار محتوا در کانال‌های تلگرام است که با **Cloudflare Workers** ساخته شده است.

نسخه `v2.0` نسخه ارتقایافته پروژه است و همچنان معماری **تک‌فایلی** خود را حفظ می‌کند. تمرکز این نسخه روی بهبود فرایند انتشار، پیش‌نویس‌ها، مدیریت کپشن و هشتگ و امکانات مدیریتی ربات است.

### ✨ امکانات

#### 📤 انتشار محتوا

* انتشار متن و رسانه در کانال‌ها
* پشتیبانی از عکس، ویدیو، فایل، صدا، ویس و انیمیشن
* پشتیبانی از آلبوم‌های رسانه‌ای
* پیش‌نمایش قبل از انتشار
* ویرایش کپشن با Reply به پیام پیش‌نمایش
* لغو انتشار قبل از ارسال
* ثبت وضعیت انتشار و تعداد موفق/ناموفق

#### 📝 کپشن و هشتگ

* پاک‌سازی خودکار کپشن
* حالت کپشن **خودکار / دستی**
* حالت هشتگ **خودکار / دستی**
* تولید هشتگ با Cloudflare Workers AI
* تولید مجدد هشتگ
* حذف هشتگ‌ها
* افزودن امضای شخصی به پست‌ها

#### 📡 مدیریت کانال

* افزودن کانال با فوروارد کردن پیام
* مشاهده کانال‌های کاربر
* حذف کانال
* انتشار در تمام کانال‌های فعال کاربر
* قابلیت **پست سراسری** برای مالک ربات

#### 👑 مدیریت کاربران

* تشخیص مالک ربات با `OWNER_ID`
* مشاهده کاربران
* مسدود کردن و رفع مسدودی کاربران
* ارسال پیام همگانی
* آمار کاربران و انتشارها

#### 💾 ذخیره‌سازی

اطلاعات کاربران، کانال‌ها، پیش‌نویس‌ها و پست‌های منتشرشده در **Cloudflare D1** ذخیره می‌شوند.

پیش‌نویس‌های قدیمی نیز به‌صورت خودکار منقضی می‌شوند.

### 🧩 فناوری‌ها

* Cloudflare Workers
* Cloudflare D1
* Cloudflare Workers AI
* Telegram Bot API
* JavaScript

### ⚙️ متغیرها و Bindingهای موردنیاز

| نام         | نوع                | کاربرد                   |
| ----------- | ------------------ | ------------------------ |
| `BOT_TOKEN` | Secret             | توکن ربات تلگرام         |
| `OWNER_ID`  | Variable/Secret    | شناسه تلگرام مالک ربات   |
| `DB`        | D1 Binding         | پایگاه‌داده ربات         |
| `AI`        | Workers AI Binding | تولید هشتگ با هوش مصنوعی |

### 🏗️ معماری

نسخه `v2.0` عمداً **تک‌فایلی** باقی مانده است:

```text
worker.js
```

تمام منطق اصلی ربات در همین فایل قرار دارد.

این سادگی بخشی از طراحی پروژه است و توسعه پروژه نیز بر همین پایه ادامه پیدا می‌کند.

### 🚀 وضعیت نسخه

**v2.0 — Stable**

آخرین نسخه پایدار فعلی پروژه.

---

## English 🇬🇧

**Telegram Channel Publisher** is a lightweight Telegram bot for managing and publishing content to Telegram channels, built with **Cloudflare Workers**.

Version `v2.0` is an upgraded release that keeps the project's **single-file architecture**. This version focuses on improving publishing, drafts, captions, hashtags, and bot administration.

### ✨ Features

#### 📤 Publishing

* Publish text and media to Telegram channels
* Support for photos, videos, documents, audio, voice messages, and animations
* Media album support
* Preview before publishing
* Edit captions by replying to the preview message
* Cancel posts before publishing
* Track successful and failed publications

#### 📝 Captions & Hashtags

* Automatic caption cleaning
* **Automatic / manual** caption mode
* **Automatic / manual** hashtag mode
* AI-powered hashtag generation using Cloudflare Workers AI
* Regenerate hashtags
* Remove hashtags
* Personal post signatures

#### 📡 Channel Management

* Add channels by forwarding a message from the channel
* View user's channels
* Remove channels
* Publish to all active user channels
* **Global publishing** for the bot owner

#### 👑 User Management

* Owner identification through `OWNER_ID`
* User management
* Ban and unban users
* Broadcast messages
* User and publishing statistics

#### 💾 Storage

Users, channels, drafts, and published posts are stored in **Cloudflare D1**.

Old drafts are also automatically expired.

### 🧩 Technology

* Cloudflare Workers
* Cloudflare D1
* Cloudflare Workers AI
* Telegram Bot API
* JavaScript

### ⚙️ Required Variables & Bindings

| Name        | Type               | Purpose                           |
| ----------- | ------------------ | --------------------------------- |
| `BOT_TOKEN` | Secret             | Telegram bot token                |
| `OWNER_ID`  | Variable/Secret    | Telegram user ID of the bot owner |
| `DB`        | D1 Binding         | Bot database                      |
| `AI`        | Workers AI Binding | AI-powered hashtag generation     |

### 🏗️ Architecture

Version `v2.0` intentionally keeps a **single-file architecture**:

```text
worker.js
```

The core bot logic lives inside this file.

This simplicity is part of the project's design and development will continue from the same single-file foundation.

### 🚀 Release Status

**v2.0 — Stable**

The current stable release of the project.

---

## License

This project is licensed under the MIT License.
