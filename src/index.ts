import axios from 'axios';
import * as path from 'path';
import * as winston from 'winston';
import TelegramBot from 'node-telegram-bot-api';


const mapKeyArea = new Map<string,string>(
    [
        ['D3340711-057B-494B-8FA0-9EEDC4C5EAD9','Hải Nam'],
        ['1E478D40-9E85-4918-BF12-478B8A19F4A8','Quảng Đông'],
        ['86DE2FFF-FF2C-47F9-8359-FD1F20D6508F','Quảng Tây'],
    ]
)

const areaKeys = ['D3340711-057B-494B-8FA0-9EEDC4C5EAD9','1E478D40-9E85-4918-BF12-478B8A19F4A8','86DE2FFF-FF2C-47F9-8359-FD1F20D6508F']

interface APIData {
    data?: any[];
    [key: string]: any;
}
interface IGetApiParams {
    articleId: string;
    channelId: string;
    _: number;
}
class APIMonitor {
    private telegramBot: TelegramBot;
    private logger!: winston.Logger;
    private checkInterval: number;
    private telegramChatId: string;
    private previousData1: APIData;
    private previousData2: APIData;
    private previousData3: APIData;

    constructor(
        private telegramBotToken: string, 
        telegramChatId: string, 
        checkInterval: number = 60
    ) {
        this.telegramBot = new TelegramBot(telegramBotToken, { polling: false });
        this.telegramChatId = telegramChatId;
        this.checkInterval = checkInterval * 1000; // Convert to milliseconds
        this.previousData1 = {};
        this.previousData2 = {};
        this.previousData3 = {};

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

    private async getApiContent({ articleId, channelId, _ }: IGetApiParams, url='https://www.msa.gov.cn/msacncms_wap//cmsarticle/getArticle'): Promise<APIData> {
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
        this.logger.info(`Starting to post form data to API: ${url}`);
        
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
    private async getChannelData(url: string, areaKey: string): Promise<APIData> {
    return this.postFormDataApi(
        url,
        areaKey,
        1,
        10
    );
    }

    private analyzeApiChanges(oldData: APIData, newData: APIData): { is_changed:boolean; message:string ; newest_content: any} {
        try {
            const changes: { is_changed:boolean; message:string ; newest_content: any} = {
                is_changed: false,
                message: "Không có tin tức mới!",
                newest_content: oldData.list[0],
            };
            
            if (!oldData || Object.keys(oldData).length === 0) {
                changes.message = "Initial data";
                return changes;
            }
  
            if (newData.list && oldData.list) {
                const newItems = newData.list;
                const oldItems = oldData.list;
                const oldArticleid = oldItems[0].articleid;
                if (newItems[0].articleid !== oldArticleid) {
                    changes.is_changed = true;
                    for (let i = 0; i < newItems.length; i++) {
                        if (newItems[i].articleid === oldArticleid) {
                            changes.message = `Có ${i} tin mới`;
                            changes.newest_content = newItems[0];
                            break;
                        }
                    }
                }
            }

        return changes

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error analyzing API changes: ${errorMessage}`);
            return  {
                is_changed: false,
                message: "Lỗi xảy ra khi phân tích thay đổi nội dung!",
                newest_content: null
            };
        }
    }

    private async sendTelegramMessage(message: string): Promise<void> {
        try {
            await this.telegramBot.sendMessage(this.telegramChatId, message, { 
                parse_mode: 'HTML' 
            });
            this.logger.info("Telegram notification sent successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error sending Telegram message: ${errorMessage}`);
        }
    }

    private async handleBuildMessage(newData: APIData,previousData: APIData, index: number) :Promise<void> {
        if (Object.keys(newData).length > 0) {
            const changes = this.analyzeApiChanges(previousData, newData);
            // const currentTime = new Date().toISOString().replace('T', ' ').split('.')[0];   

            // if (changes.is_changed) {
                const changedContent = changes.newest_content;
                const articleId = changedContent.articleid;
                const channelId = changedContent.channelId;
                const _ = new Date().getTime();
                const changeDetail = await this.getApiContent({articleId,channelId,_});
                const area = mapKeyArea.get(areaKeys[index]) || 'Khu vực mới'

                const message = 
                    `🔔 <b>${changes.message}!</b>\n\n` +
                    `🌐 Khu vực: ${area}\n\n` +
                    `⏰ Time: ${changeDetail.articlepublishtime}\n\n` +
                    `📝 Tiêu đề bài mới nhất: ${changeDetail.articletitle}\n
                        Nội dung bài mới nhất:\n${changeDetail.articledescription}
                    `;

                await this.sendTelegramMessage(message);
            // }
        }
    }

    public async monitorApi(apiUrl: string): Promise<void> {
        this.logger.info(`Starting to monitor API: ${apiUrl}`);

        let [initialData1,initialData2,initialData3] = await Promise.all([
            this.getChannelData(apiUrl,areaKeys[0]),
            this.getChannelData(apiUrl,areaKeys[1]),
            this.getChannelData(apiUrl,areaKeys[2]),
        ]) 
        this.previousData1 = initialData1;
        this.previousData2 = initialData2;
        this.previousData3 = initialData3;

        setInterval(async () => {
            try {
                this.logger.info("Checking API for changes...");
                const [newData1,newData2,newData3] = await Promise.all([
                    this.getChannelData(apiUrl, areaKeys[0]),
                    this.getChannelData(apiUrl, areaKeys[1]),
                    this.getChannelData(apiUrl, areaKeys[2]),
                ]) 

                await Promise.all([
                    this.handleBuildMessage(newData1,this.previousData1,0),
                    this.handleBuildMessage(newData2,this.previousData2,1),
                    this.handleBuildMessage(newData3,this.previousData3,2),
                ])
         
                this.previousData1 = newData1;
                this.previousData2 = newData2;
                this.previousData3 = newData3;

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
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
    const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "3600", 10);
    const API_URL = process.env.API_URL || "https://www.msa.gov.cn/msacncms_wap//cmschannel/selectArticle/pageListById";

    const monitor = new APIMonitor(
        TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID,
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