import winston from 'winston';
import path from 'path';

const logPath = path.resolve('./logs/api_monitor.log');

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} - ${info.level}: ${info.message}`)
    ),
    transports: [
        new winston.transports.File({ filename: logPath }),
        new winston.transports.Console()
    ]
});