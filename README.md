# Telegram Channel Publisher

> A lightweight Telegram channel publishing bot built with Cloudflare Workers.

## فارسی 🇮🇷

**Telegram Channel Publisher** یک ربات سبک برای انتشار محتوا در کانال‌های تلگرام است که با **Cloudflare Workers** ساخته شده است.

نسخه `v1.0` اولین نسخه پایدار پروژه است و با تمرکز روی سادگی، سبک بودن و مدیریت مستقیم انتشار محتوا طراحی شده است.

### ✨ امکانات

* انتشار پست در کانال‌های تلگرام
* مدیریت چند کانال برای هر کاربر
* افزودن کانال با فوروارد کردن پیام از کانال
* حذف کانال
* پیش‌نمایش پست قبل از انتشار
* ویرایش کپشن قبل از انتشار
* لغو پیش‌نویس
* افزودن امضای شخصی به پست‌ها
* تولید هشتگ با استفاده از Cloudflare Workers AI
* مدیریت کاربران
* مسدود کردن کاربران
* ارسال پیام همگانی توسط مالک
* انتشار یک پست به تمام کانال‌های فعال از طریق قابلیت پست سراسری
* ذخیره اطلاعات کاربران، کانال‌ها، پیش‌نویس‌ها و پست‌ها در Cloudflare D1

### 🧩 فناوری‌ها

* Cloudflare Workers
* Cloudflare D1
* Cloudflare Workers AI
* Telegram Bot API
* JavaScript

### ⚙️ متغیرها و Bindingهای موردنیاز

| نام         | نوع                | کاربرد                |
| ----------- | ------------------ | --------------------- |
| `BOT_TOKEN` | Secret             | توکن ربات تلگرام      |
| `OWNER_ID`  | Variable/Secret    | شناسه کاربر مالک ربات |
| `DB`        | D1 Binding         | پایگاه‌داده پروژه     |
| `AI`        | Workers AI Binding | تولید خودکار هشتگ     |

### 🚀 وضعیت نسخه

**v1.0 — Stable**

این نسخه اولین Release پایدار پروژه است.

---

## English 🇬🇧

**Telegram Channel Publisher** is a lightweight Telegram bot for publishing content to Telegram channels, built with **Cloudflare Workers**.

Version `v1.0` is the first stable release of the project, focused on simplicity, lightweight operation, and direct content publishing.

### ✨ Features

* Publish posts to Telegram channels
* Manage multiple channels per user
* Add channels by forwarding a message from the channel
* Remove channels
* Preview posts before publishing
* Edit captions before publishing
* Cancel drafts
* Add personal signatures to posts
* Generate hashtags using Cloudflare Workers AI
* User management
* Ban users
* Owner-only broadcast messaging
* Publish a post to all active channels using the global publishing feature
* Store users, channels, drafts, and published posts in Cloudflare D1

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
| `DB`        | D1 Binding         | Project database                  |
| `AI`        | Workers AI Binding | Automatic hashtag generation      |

### 🚀 Release Status

**v1.0 — Stable**

The first stable release of the project.

---

## License

This project is licensed under the MIT License.
