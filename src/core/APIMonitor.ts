import sanitizeHtml from 'sanitize-html';
import { APIData, INewData, TRANSLATE_SYSTEM_PROMPT } from './type';
import { defaultAxios } from '../utils/http';
import { logger } from '../utils/logger';
import OpenAI from 'openai';

export class APIMonitor {
    private openai: OpenAI;
    constructor(
        private checkInterval = 3600,
    ) {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || '',
        });
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
            logger.error(`postFormDataApi error: ${String(error)} ${url} channelId=${channelId} pageNum=${pageNum} pageSize=${pageSize}`);
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

    public async translateMultiline(text: string): Promise<string> {
        if (!text) return '';

        const SEPARATOR = '|||';
        const maxRetries = 3;
        const baseDelay = 200;

        // Tách thành từng dòng, bỏ dòng trắng
        const segments = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '');

        if (segments.length === 0) return '';

        // Gộp tất cả dòng thành 1 prompt duy nhất
        const combinedText = segments.join(`\n${SEPARATOR}\n`);

        const systemPrompt = TRANSLATE_SYSTEM_PROMPT(SEPARATOR);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    temperature: 0.1,   // Độ sáng tạo thấp → dịch nhất quán hơn
                    max_tokens: 16384,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: combinedText },
                    ],
                }, {
                    timeout: 60_000,     // ← thêm timeout 60s
                });

                const translated = response.choices[0]?.message?.content?.trim() || '';
                const translatedSegments = translated.split(SEPARATOR).map(s => s.trim());

                // Nếu số đoạn khớp → dùng luôn
                if (translatedSegments.length === segments.length) {
                    return translatedSegments.join('\n');
                }

                // Nếu không khớp số đoạn → log warning nhưng vẫn dùng kết quả
                logger.warn(
                    `⚠️ Số đoạn dịch không khớp: expected ${segments.length}, got ${translatedSegments.length}. Dùng kết quả nguyên.`
                );
                return translated;

            } catch (err: any) {
                const errMsg = err?.message || String(err);
                logger.error(`❌ OpenAI translate error(attempt ${attempt} / ${maxRetries}): ${errMsg} `);

                if (attempt < maxRetries) {
                    const wait = baseDelay * Math.pow(2, attempt - 1);
                    await new Promise(res => setTimeout(res, wait));
                } else {
                    logger.error('⚠️ Hết lượt retry, trả về text gốc.');
                    return text; // fallback về text gốc
                }
            }
        }

        return text;
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

}