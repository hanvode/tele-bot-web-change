import { APIMonitor } from "../core/APIMonitor";
import { Worker } from "bullmq";
import { logger } from "../utils/logger";
import { defaultAxios } from "../utils/http";


const apiMonitor = new APIMonitor(process.env.PROXY_URL_TRANSLATE || '', Number(process.env.CHECK_INTERVAL || 60));

export const worker = new Worker('monitorQueue', async job => {
    const { apiUrl, areaKey, index, areaName } = job.data;
    const start = Date.now();
    logger.info(`[Worker] job ${job.id} areaKey=${areaKey}`);


    const newData = await apiMonitor.getChannelData(apiUrl, areaKey);
    let message = await apiMonitor.handleBuildMessage(newData, areaName);

    if (message && message.trim()) {
        message = index < 3 ? `🔔 Cảnh báo hàng hải\n\n` + message : `🔔 Thông báo\n\n` + message;
        const cleanMessage = apiMonitor.sanitizeForTelegram(message);
        const parts = apiMonitor.splitMessage(cleanMessage);
        const url = `${process.env.PROXY_URL || ''}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        for (const part of parts) {
            try {
                const response = await defaultAxios.post(url, { chat_id: Number(process.env.TELEGRAM_CHAT_ID), text: part, parse_mode: 'HTML' }, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                logger.info("✅ Telegram notification sent successfully", response.data);
            } catch (err) {
                logger.error('Send Telegram error: ' + String(err));
            }
        }
    }


    logger.info(`[Worker] finished job ${job.id} in ${Date.now() - start}ms`);
    return { success: true, count: newData.length };
}, {
    connection: { host: process.env.REDIS_HOST || 'redis', port: Number(process.env.REDIS_PORT) || 6379 },
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3)
});


worker.on('completed', job => logger.info(`[Worker] completed ${job.id}`));
worker.on('failed', (job, err) => logger.error(`[Worker] failed ${job?.id} ${String(err)}`));