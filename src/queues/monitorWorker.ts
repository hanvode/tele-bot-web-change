import { APIMonitor } from "../core/APIMonitor";
import { Worker } from "bullmq";
import { logger } from "../utils/logger";
import { defaultAxios } from "../utils/http";


const apiMonitor = new APIMonitor(process.env.PROXY_URL_TRANSLATE || '', Number(process.env.CHECK_INTERVAL || 60));

export const worker = new Worker('monitorQueue', async job => {
    const { apiUrl, areaKey, index, areaName, sentIndices = [] } = job.data;
    const start = Date.now();
    logger.info(`[Worker] job ${job.id} areaKey=${areaKey}`);


    const newData = await apiMonitor.getChannelData(apiUrl, areaKey);
    let message = await apiMonitor.handleBuildMessage(newData, areaName);

    if (message && message.trim()) {
        message = index < 3 ? `🔔 Cảnh báo hàng hải\n\n` + message : `🔔 Thông báo\n\n` + message;
        const cleanMessage = apiMonitor.sanitizeForTelegram(message);
        const parts = apiMonitor.splitMessage(cleanMessage);
        const url = `${process.env.PROXY_URL || ''}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        for (let i = 0; i < parts.length; i++) {
            // KIỂM TRA: Nếu index này đã có trong danh sách đã gửi -> Bỏ qua
            if (sentIndices.includes(i)) {
                logger.info(`[Worker] Skipping part ${i} because it was already sent.`);
                continue;
            }
            const part = parts[i];
            try {
                const response = await defaultAxios.post(url, { chat_id: Number(process.env.TELEGRAM_CHAT_ID), text: part, parse_mode: 'HTML' }, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                logger.info("✅ Telegram notification sent successfully", response.data);
                sentIndices.push(i); // Thêm index vào danh sách đã gửi
                // Ghi đè lại data của job trong Redis để lần retry sau nó nhớ
                await job.updateData({
                    ...job.data,
                    sentIndices: sentIndices
                });
                
            } catch (err) {
                logger.error('Send Telegram error: ' + String(err));
                throw err;
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