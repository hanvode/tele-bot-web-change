import { Queue } from "bullmq";

export const monitorQueue = new Queue("monitorQueue", {
    connection: {
        host: process.env.REDIS_HOST || "redis",
        port: Number(process.env.REDIS_PORT) || 6379,
    },
});
