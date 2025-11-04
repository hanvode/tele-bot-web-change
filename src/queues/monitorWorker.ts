// src/queues/monitorWorker.ts
import { Worker } from "bullmq";
import { APIMonitor } from "../index"; // lớp của bạn
const PROXY_URL = process.env.PROXY_URL || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "3600", 10);
const apiMonitor = new APIMonitor(TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    PROXY_URL,
    CHECK_INTERVAL);

export const monitorWorker = new Worker(
    "monitorQueue",
    async (job) => {
        const { apiUrl, areaKey, index } = job.data;

        console.log(`[Worker] Processing job for areaKey=${areaKey}`);

        const newData = await apiMonitor.getChannelData(apiUrl, areaKey);
        const message = await apiMonitor.handleBuildMessage(newData, index);

        console.log(`[Worker] Finished job for ${areaKey}, ${newData.length} posts`);
        if (newData.length > 0) {
            // 🔔 Gửi Telegram trực tiếp từ worker
            await apiMonitor.sendTelegramMessage(
                `🔔 Khu vực ${areaKey} có ${newData.length} tin mới:\n${message}`
            );
            console.log(`[Worker] Sent Telegram for ${areaKey}`);
        }
        return { success: true, count: newData.length, message };
    },
    {
        connection: {
            host: process.env.REDIS_HOST || "redis",
            port: Number(process.env.REDIS_PORT) || 6379,
        },
        concurrency: 3, // giới hạn số job chạy song song
    }
);

monitorWorker.on("completed", (job) => {
    console.log(`[Worker] Job completed: ${job.id}`);
});

monitorWorker.on("failed", (job, err) => {
    console.log(`[Worker] Job failed: ${job?.id} - ${err.message}`);
});
