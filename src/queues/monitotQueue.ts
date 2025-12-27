import { Queue } from "bullmq";
import { logger } from "../utils/logger";


const connection = { host: process.env.REDIS_HOST || 'redis', port: Number(process.env.REDIS_PORT) || 6379 };
export const monitorQueue = new Queue('monitorQueue', { connection });


// handle global errors
monitorQueue.on('error', (err) => logger.error('Queue error: ' + String(err)));