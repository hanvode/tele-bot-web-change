import axios from 'axios';
import * as path from 'path';
import * as winston from 'winston';
import { translate } from '@vitalets/google-translate-api';


const mapKeyArea = new Map<string, string>(
    [
        ['D3340711-057B-494B-8FA0-9EEDC4C5EAD9', 'Hải Nam'],
        ['1E478D40-9E85-4918-BF12-478B8A19F4A8', 'Quảng Đông'],
        ['86DE2FFF-FF2C-47F9-8359-FD1F20D6508F', 'Quảng Tây'],
        ['5EB28631-6746-4A6F-AAA1-FCA5BFF0A2A9', 'Hải Nam'],
        ['32FA3793-3941-48F7-B5C3-EC112D2BF8AF', 'Quảng Đông'],
        ['8375B077-B2CF-4281-A46B-68E2FF8AA08F', 'Quảng Tây'],
    ]
)
const areaKeys = ['D3340711-057B-494B-8FA0-9EEDC4C5EAD9', '1E478D40-9E85-4918-BF12-478B8A19F4A8', '86DE2FFF-FF2C-47F9-8359-FD1F20D6508F', '5EB28631-6746-4A6F-AAA1-FCA5BFF0A2A9', '32FA3793-3941-48F7-B5C3-EC112D2BF8AF', '8375B077-B2CF-4281-A46B-68E2FF8AA08F']

interface INewData {
    articleid: string;
    channelId: string;
    articletitle?: string;
    publishtime?: string;
    [key: string]: any;
}

interface APIData {
    data?: any[];
    list?: INewData[];
    articletitle?: string;
    articlepublishtime?: string;
    articledescription?: string;
    [key: string]: any;
}

interface IGetApiParams {
    articleId: string;
    channelId: string;
    _: number;
}
class APIMonitor {
    private logger!: winston.Logger;
    private checkInterval: number;
    private telegramChatId: string;
    private proxyURL: string;
    private mapIdNew: Map<string, APIData>;

    constructor(
        private telegramBotToken: string,
        telegramChatId: string,
        proxyURL: string,
        checkInterval: number = 60
    ) {
        this.telegramChatId = telegramChatId;
        this.proxyURL = proxyURL;
        this.checkInterval = checkInterval * 1000; // Convert to milliseconds
        this.mapIdNew = new Map<string, APIData>();

        this.setupLogging();
    }

    private setupLogging(): void {
        // Use a specific file path
        const logPath = path.resolve('./logs/api_monitor.log');

        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf((info: winston.Logform.TransformableInfo) => {
                    return `${info.timestamp} - ${info.level}: ${info.message}`;
                })
            ),
            transports: [
                new winston.transports.File({
                    filename: logPath,
                }),
                new winston.transports.Console()
            ]
        });
    }

    private async getApiContent({ articleId, channelId, _ }: IGetApiParams, url = 'https://www.msa.gov.cn/msacncms_wap//cmsarticle/getArticle'): Promise<APIData> {
        try {
            this.logger.info(`Starting to fetch API content: ${url}`);

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                params: {
                    articleId,
                    channelId,
                    _: _,
                },
                timeout: 30000
            });

            return response.data;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error fetching API ${url}: ${errorMessage}`);
            return {};
        }
    }

    /**
    * Gửi POST request với form data đến API endpoint và trả về dữ liệu
    * @param url URL của API endpoint
    * @param channelId ID của kênh
    * @param pageNum Số trang
    * @param pageSize Kích thước trang
    * @returns Promise với dữ liệu trả về từ API
     */
    private async postFormDataApi(url: string, channelId: string, pageNum: number, pageSize: number): Promise<APIData> {
        try {
            this.logger.info(`Starting to post ${pageSize} form data from ${pageNum} to API: ${url}`);

            // Tạo đối tượng FormData
            const formData = new FormData();
            formData.append('channelId', channelId);
            formData.append('pageNum', pageNum.toString());
            formData.append('pageSize', pageSize.toString());

            const response = await axios.post(url, formData, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    // Content-Type sẽ tự động được thiết lập bởi axios khi sử dụng FormData
                },
                timeout: 30000
            });

            return response.data;
        } catch (error) {
            this.logger.error(`Error posting form data to API: ${url}`, error);
            throw error;
        }
    }

    // Ví dụ sử dụng với giá trị cụ thể
    private async getChannelData(url: string, areaKey: string): Promise<INewData[]> {
        const now = new Date();
        const currentDate = this.getDateString(now);
        const newDatas: INewData[] = [];
        let isContinuePost = true;
        let start = 1;
        while (isContinuePost) {
            const dataFromApiPost = await this.postFormDataApi(url, areaKey, start, 10);
            if (dataFromApiPost.list) {
                for (const newData of dataFromApiPost.list) {
                    const timeItem = newData.articlepublishtime;
                    const [dateItem] = timeItem.split(" ");
                    if (dateItem === currentDate) {
                        newDatas.push(newData);
                    } else {
                        isContinuePost = false;
                        break;
                    }
                }
                start += 10;
            }
        }
        return newDatas;
    }

    /**
   * Lấy chuỗi ngày theo định dạng YYYY-MM-DD
   */
    private getDateString(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private async translateViaProxy(text: string): Promise<string> {
        try {
            const response = await axios.post('https://translate.nhachoc1999.workers.dev', {
                q: text,
                from: 'zh-CN',
                to: 'vi'
            });

            return response.data.translatedText;
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('❌ Lỗi dịch qua proxy:', errMsg);
            return text; // fallback
        }
    }



    private async translateMultiline(text: string): Promise<string> {
        if (!text) return '';
        const segments = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '');

        const translatedLines: string[] = [];
        const batchSize = 5; // Số dòng mỗi batch
        const separator = '|||'; // Dùng để tách các dòng trong batch

        for (let i = 0; i < segments.length; i += batchSize) {
            const batch = segments.slice(i, i + batchSize);
            const batchText = batch.join(`\n${separator}\n`);

            try {
                const translatedBatch = await this.translateViaProxy(batchText);
                const lines = translatedBatch.split(separator).map(l => l.trim());
                // Nếu số dòng dịch ra khớp, dùng luôn
                if (lines.length === batch.length) {
                    translatedLines.push(...lines);
                } else {
                    console.warn(`⚠️ Số dòng dịch không khớp batch (${i}): fallback về bản gốc`);
                    translatedLines.push(...batch);
                }

            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error(`❌ Lỗi dịch batch tại dòng ${i}:`, errMsg);
                translatedLines.push(...batch); // fallback nếu lỗi
            }
        }

        return translatedLines.join('\n');
    }


    // private async translateMultiline1(text: string): Promise<string> {
    //     const segments = text.split('\n').filter(line => line.trim() !== '');
    //     const translatedLines = [];

    //     for (const line of segments) {
    //         try {
    //             const { text: translated } = await translate(line, {
    //                 from: 'zh-CN',
    //                 to: 'vi'
    //             });
    //             translatedLines.push(translated);
    //         } catch (err: unknown) {
    //             const errorMessage = err instanceof Error ? err.message : String(err);
    //             console.error('Lỗi dịch dòng:', line, errorMessage);
    //             translatedLines.push(line); // fallback: giữ nguyên nếu lỗi
    //         }
    //     }

    //     return translatedLines.join('\n');
    // };

    private splitMessage(message: string, maxLength = 3000): string[] {
        let parts = [];
        for (let i = 0; i < message.length; i += maxLength) {
            parts.push(message.slice(i, i + maxLength));
        }
        return parts;
    }

    private async sendTelegramMessage(message: string): Promise<void> {
        try {
            const parts = this.splitMessage(message);
            const url = `${this.proxyURL}/bot${this.telegramBotToken}/sendMessage`;

            for (let part of parts) {
                const response = await axios.post(url, {
                    chat_id: Number(this.telegramChatId),
                    text: part,
                    parse_mode: 'HTML'
                }, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                this.logger.info("✅ Telegram notification sent successfully", response.data);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error sending Telegram message: ${errorMessage}`);
        }
    }


    private async handleBuildMessage(newData: INewData[], index: number): Promise<string> {
        let messageArea: string = ''
        if (newData.length > 0) {
            const area = mapKeyArea.get(areaKeys[index]) || 'Khu vực mới'
            messageArea += `🌐 Khu vực: ${area} có ${newData.length} tin mới\n\n`
            let stt = 1;
            for (let i = newData.length - 1; i >= 0; i--) {
                const itemChange = newData[i];
                const articleId = itemChange.articleid;
                let existedNew = this.mapIdNew.get(articleId);
                if (!existedNew) {
                    const channelId = itemChange.channelId;
                    const _ = new Date().getTime();
                    existedNew = await this.getApiContent({ articleId, channelId, _ });
                    this.mapIdNew.set(articleId, existedNew);
                }
                if (existedNew.articletitle?.includes('井钻') || existedNew.articledescription?.includes('井钻') || existedNew.articletitle?.includes('海洋石油') || existedNew.articledescription?.includes('海洋石油')) {
                    messageArea += `🔔 Tin quan trọng!!\n`
                }
                messageArea += `⏰ Thời gian: ${existedNew.articlepublishtime} (giờ Trung Quốc)\n` +
                    `📝 ${stt}. Tiêu đề bài: ${(await this.translateMultiline(existedNew.articletitle || ''))}\n
                        Nội dung bài:\n${(await this.translateMultiline(existedNew.articledescription || ''))}\n\n`;
                stt++;
            }
        }
        return messageArea;
    }

    public async monitorApi(apiUrl: string): Promise<void> {
        this.logger.info(`Starting to monitor API: ${apiUrl}`);
        setInterval(async () => {
            try {
                this.logger.info("Checking API for changes...");
                const [newDatas1, newDatas2, newDatas3, newDatasNoti1, newDatasNoti2, newDatasNoti3] = await Promise.all([
                    this.getChannelData(apiUrl, areaKeys[0]),
                    this.getChannelData(apiUrl, areaKeys[1]),
                    this.getChannelData(apiUrl, areaKeys[2]),
                    this.getChannelData(apiUrl, areaKeys[3]),
                    this.getChannelData(apiUrl, areaKeys[4]),
                    this.getChannelData(apiUrl, areaKeys[5]),
                ])

                const [mess1, mess2, mess3, noti1, noti2, noti3] = await Promise.all([
                    this.handleBuildMessage(newDatas1, 0),
                    this.handleBuildMessage(newDatas2, 1),
                    this.handleBuildMessage(newDatas3, 2),
                    this.handleBuildMessage(newDatasNoti1, 3),
                    this.handleBuildMessage(newDatasNoti2, 4),
                    this.handleBuildMessage(newDatasNoti3, 5),
                ])
                const now = new Date();
                const currentDate = this.getDateString(now);
                const countNews = newDatas1.length + newDatas2.length + newDatas3.length;
                let messageAll: string = `🔔 Cảnh báo hàng hải\n\n` +
                    `🌐 Có ${countNews} tin mới ngày ${currentDate}\n` + `${mess1}\n\n\n` + `${mess2}\n\n\n` + `${mess3}`

                const countNotis = newDatasNoti1.length + newDatasNoti2.length + newDatasNoti3.length;
                let messageNotiAll: string = `🔔 Thông báo\n\n` +
                    `🌐 Có ${countNotis} tin mới ngày ${currentDate}\n` + `${noti1}\n\n\n` + `${noti2}\n\n\n` + `${noti3}`

                await this.sendTelegramMessage(messageAll);
                await this.sendTelegramMessage(messageNotiAll);

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error(`An error occurred: ${errorMessage}`);
            }
        }, this.checkInterval);

        // Keep the process running
        this.logger.info("API monitor is now running. Press Ctrl+C to exit.");
    }
}

async function main() {
    const PROXY_URL = process.env.PROXY_URL || '';
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
    const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "3600", 10);
    const API_URL = process.env.API_URL || "https://www.msa.gov.cn/msacncms_wap//cmschannel/selectArticle/pageListById";

    const monitor = new APIMonitor(
        TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID,
        PROXY_URL,
        CHECK_INTERVAL
    );

    await monitor.monitorApi(API_URL);

    // Prevent Node.js from exiting
    process.on('SIGINT', () => {
        console.log('Gracefully shutting down');
        process.exit(0);
    });
}

// Start the application
main().catch((error) => {
    console.error("Application failed to start:", error);
    process.exit(1);
});