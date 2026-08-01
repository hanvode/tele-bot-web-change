import { APIMonitor } from "../core/APIMonitor";
import { IAttachment } from "../core/type";
import { Worker } from "bullmq";
import { logger } from "../utils/logger";
import { defaultAxios } from "../utils/http";


type SentKey = string;

function makeSentKey(postIndex: number, partIndex: number): SentKey {
    return `${postIndex}:${partIndex}`;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const apiMonitor = new APIMonitor(Number(process.env.CHECK_INTERVAL || 60));

export const worker = new Worker('monitorQueue', async job => {
    const { apiUrl, areaKey, index, areaName } = job.data;
    const sentKeys: SentKey[] = job.data.sentKeys ?? [];
    const start = Date.now();
    logger.info(`[Worker] job ${job.id} area ${areaName} sentKeys: ${sentKeys.length}`);
    const tabTitle = index > 3 ? `🔔 Cảnh báo hàng hải: ` : `🔔 Thông báo: `;

    const areaDatas = await apiMonitor.getChannelData(apiUrl, areaKey);
    const sortedPosts = areaDatas.sort((a, b) => new Date(a.articlePublishTime || '').getTime() - new Date(b.articlePublishTime || '').getTime());
    const telegramUrl = `${process.env.PROXY_URL || ''}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    if (sortedPosts.length === 0) {
        logger.info(`[Worker] no new posts ${tabTitle} for area ${areaName}`);
        return { success: true, count: 0 };
    }
    const headerKey = 'header:0';
    if (!sentKeys.includes(headerKey)) {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const headerText = tabTitle + `<b>${areaName}</b> có <b>${sortedPosts.length}</b> tin mới ngày ${dateStr}`;
        await sendTelegramMessage(telegramUrl, headerText);

        sentKeys.push(headerKey);
        await job.updateData({ ...job.data, sentKeys });
    }

    for (let postIndex = 0; postIndex < sortedPosts.length; postIndex++) {
        const post = sortedPosts[postIndex];
        const isImportantNew = post.articleTitle?.includes('井钻') || post.articleText?.includes('井钻') || post.articleTitle?.includes('海洋石油') || post.articleText?.includes('海洋石油');
        // Dịch nội dung bài
        const translatedText = await apiMonitor.translateMultiline(post?.articleText || '');
        const translatedTitle = await apiMonitor.translateMultiline(post?.articleTitle || '');
        // const sourceLine = post.source ? `\n📍 Nguồn: ${escapeHtml(post.source)}` : '';
        const attachmentsLine = post.attachments?.length
            ? '\n📎 Đính kèm:\n' + post.attachments
                .map((a: IAttachment) => `<a href="${a.url}">${escapeHtml(a.name || 'Tệp đính kèm')}</a>`)
                .join('\n')
            : '';

        // Tạo nội dung tin nhắn cho post này
        const postMessage =
            `${postIndex + 1}.${isImportantNew ? `🔔 Tin quan trọng!!` : ``} ${tabTitle} ${areaName} đăng lúc ${post.articlePublishTime || post.publishTime || ''} (giờ TQ)\n` +
            `📝 Tiêu đề: ${translatedTitle}\n` +
            `Nội dung: ${apiMonitor.sanitizeForTelegram(translatedText)}` +
            attachmentsLine;

        // Cắt thành nhiều parts nếu quá dài
        const parts = apiMonitor.splitMessage(postMessage);

        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const key = makeSentKey(postIndex, partIndex);

            // Bỏ qua nếu đã gửi thành công ở lần chạy trước
            if (sentKeys.includes(key)) {
                logger.info(`[Worker] skip already sent: post=${postIndex} part=${partIndex}`);
                continue;
            }

            const part = parts[partIndex];
            // Nếu bị cắt nhiều phần, thêm indicator
            const textToSend = parts.length > 1
                ? `${part}\n<i>(phần ${partIndex + 1}/${parts.length})</i>`
                : part;

            await sendTelegramMessage(telegramUrl, textToSend);

            // Đánh dấu đã gửi và persist ngay vào Redis
            sentKeys.push(key);
            await job.updateData({ ...job.data, sentKeys });

            logger.info(`[Worker] ✅ sent post=${postIndex + 1}/${sortedPosts.length} part=${partIndex + 1}/${parts.length}`);

        }
    }


    logger.info(`[Worker] finished job ${job.id} in ${Date.now() - start}ms`);
    return { success: true, count: areaDatas.length };
}, {
    connection: { host: process.env.REDIS_HOST || 'redis', port: Number(process.env.REDIS_PORT) || 6379 },
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3)
});

// ── Helper: gửi message lên Telegram ──────────────────────────────────────
async function sendTelegramMessage(url: string, text: string): Promise<void> {
    try {
        const response = await defaultAxios.post(url, {
            chat_id: Number(process.env.TELEGRAM_CHAT_ID),
            text,
            parse_mode: 'HTML'
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        logger.info(`✅ Telegram sent: ${response.data?.ok}`);
    } catch (err) {
        logger.error('❌ Send Telegram error: ' + String(err));
        throw err; // ném lên để BullMQ retry job
    }
}

worker.on('completed', job => logger.info(`[Worker] completed ${job.id}`));
worker.on('failed', (job, err) => logger.error(`[Worker] failed ${job?.id} ${String(err)}`));