import axios from 'axios';
import sanitizeHtml from 'sanitize-html';
import { APIData, INewData } from './type';
import { defaultAxios } from '../utils/http';
import { logger } from '../utils/logger';

export class APIMonitor {
    constructor(
        private translateProxy = '',
        private checkInterval = 3600,
    ) {
    }

    public async getApiContent(articleId: string, channelId: string): Promise<APIData> {
        try {
            const res = await defaultAxios.get('https://www.msa.gov.cn/msacncms_wap//cmsarticle/getArticle', { params: { articleId, channelId, _: Date.now() } });
            return res.data || {};
        } catch (error) {
            logger.error(`getApiContent error: ${String(error)}`);
            throw error;
        }
    }

    private async postFormDataApi(url: string, channelId: string, pageNum: number, pageSize: number): Promise<APIData> {
        try {
            const form = new FormData();
            form.append('channelId', channelId);
            form.append('pageNum', pageNum.toString());
            form.append('pageSize', pageSize.toString());
            const res = await defaultAxios.post(url, form);
            return res.data || {};
        } catch (error) {
            logger.error(`postFormDataApi error: ${String(error)}`);
            throw error;
        }
    }

    // Ví dụ sử dụng với giá trị cụ thể
    public async getChannelData(url: string, areaKey: string): Promise<INewData[]> {
        const now = Date.now()
        const thresholdTime = now - (this.checkInterval * 1000);
        const newDatas: INewData[] = [];
        let isContinuePost = true;
        let start = 1;
        while (isContinuePost) {
            let dataFromApiPost;
            try {
                dataFromApiPost = await this.postFormDataApi(url, areaKey, start, 10);
            } catch (error) {
                throw error;
            }

            if (!dataFromApiPost) {
                throw new Error("API trả về dữ liệu rỗng (null/undefined)");
            }

            if (!dataFromApiPost.list || dataFromApiPost.list.length === 0) break;

            for (const newData of dataFromApiPost.list) {
                const postTime = new Date(newData.articlepublishtime).getTime();
                if (postTime < thresholdTime) {
                    if (newData.isTop) continue;
                    isContinuePost = false;
                    break;
                }
                newDatas.push(newData);
            }
            start += 10;

        }
        return newDatas;
    }


    private async translateViaProxy(text: string): Promise<string> {
        const maxRetries = 3;                     // thử lại tối đa 3 lần
        const baseDelay = 500;                    // 500ms → 1s → 2s (exponential)

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.post(this.translateProxy, {
                    q: text,
                    from: "zh-CN",
                    to: "vi"
                }, {
                    timeout: 5000,                // tránh treo request
                });

                return response.data.translatedText;
            } catch (err: any) {
                const errMsg = err?.message || String(err);
                console.error(`❌ Lỗi dịch qua proxy (attempt ${attempt}/${maxRetries}):`, errMsg, text);

                if (attempt < maxRetries) {
                    // exponential backoff delay
                    const wait = baseDelay * Math.pow(2, attempt - 1);
                    await new Promise(res => setTimeout(res, wait));
                } else {
                    // hết retry → fallback
                    console.error("⚠️ Hết lượt retry, trả về text gốc:", text);
                    return text;
                }
            }
        }

        return text; // fallback an toàn (không chạy tới đây)
    }



    public async translateMultiline(text: string): Promise<string> {
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


    public splitMessage(message: string, maxLength = 3000): string[] {
        let parts = [];
        for (let i = 0; i < message.length; i += maxLength) {
            parts.push(message.slice(i, i + maxLength));
        }
        return parts;
    }

    public sanitizeForTelegram(message: string): string {
        if (!message) return '';

        // Loại bỏ toàn bộ HTML tag
        let clean = sanitizeHtml(message, {
            allowedTags: [], // Không cho phép tag nào cả
            allowedAttributes: {}, // Không cho phép attribute nào
        });

        // Telegram có thể lỗi nếu còn các ký tự đặc biệt chưa encode
        clean = clean
            .replace(/&nbsp;/g, ' ') // thay &nbsp; bằng space
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/<[^>]*>/g, '') // đảm bảo remove tag còn sót
            .replace(/\*/g, '\\*') // tránh lỗi markdown khi send parse_mode=Markdown
            .replace(/_/g, '\\_')
            .replace(/`/g, '\\`')
            .replace(/\[/g, '\\[');

        return clean.trim();
    }


    public async handleBuildMessage(newData: INewData[], areaName: string): Promise<string> {
        let messageArea: string = ''
        if (newData.length > 0) {
            messageArea += `🌐 Khu vực: ${areaName} có ${newData.length} tin mới\n\n`
            let stt = 1;
            for (let i = newData.length - 1; i >= 0; i--) {
                const itemChange = newData[i];
                const articleId = itemChange.articleid;
                const channelId = itemChange.channelId;
                const existedNew = await this.getApiContent(articleId, channelId);
                if (existedNew.articletitle?.includes('井钻') || existedNew.cmsArticleContent?.articlecontent?.includes('井钻') || existedNew.articletitle?.includes('海洋石油') || existedNew.cmsArticleContent?.articlecontent?.includes('海洋石油')) {
                    messageArea += `🔔 Tin quan trọng!!\n`
                }
                messageArea += `⏰ Thời gian: ${existedNew?.articlepublishtime} (giờ Trung Quốc)\n` +
                    `📝 ${stt}. Tiêu đề bài: ${(await this.translateMultiline(existedNew?.articletitle || ''))}\n
                        Nội dung bài:\n${(await this.translateMultiline(existedNew?.cmsArticleContent?.articlecontent || ''))}\n\n`;
                stt++;
            }
        }
        return messageArea;
    }

}