import sanitizeHtml from 'sanitize-html';
import * as cheerio from 'cheerio/slim';
import { APIData, IAttachment, INewData, TRANSLATE_SYSTEM_PROMPT } from './type';
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

    private async getArticleContent(articleId: string, channelId: string): Promise<{
        articleTitle: string;
        articleText: string;
        source?: string;
        publishTime?: string;
        attachments: IAttachment[];
    }> {
        try {
            const res = await defaultAxios.get('https://www.msa.gov.cn/msacncms_wap/pages/content.jhtml', { params: { articleId, channelId } });
            const $ = cheerio.load(res.data || '');

            const meta = (name: string) => $(`meta[name="${name}"]`).attr('content')?.trim();

            const contentNode = $('.content-page-main');

            const attachments: IAttachment[] = [];
            contentNode.find('a[href]').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;
                attachments.push({
                    name: $(el).text().trim(),
                    url: new URL(href, 'https://www.msa.gov.cn').toString(),
                });
            });

            // clone để bỏ ảnh/script/style trước khi lấy text, không ảnh hưởng DOM gốc
            const cloned = contentNode.clone();
            cloned.find('img,script,style').remove();

            const paragraphs = cloned
                .find('p')
                .map((_, el) => $(el).text().trim())
                .get()
                .filter(Boolean);
            const rawText = paragraphs.length > 0 ? paragraphs.join('\n') : cloned.text().trim();
            const articleText = rawText
                .replace(/\u00A0/g, ' ')
                .replace(/\r/g, '')
                .replace(/\n\s*\n/g, '\n')
                .replace(/[ \t]+/g, ' ')
                .trim();

            const articleTitle = meta('ArticleTitle') ?? $('.content-page-tit').text().trim();
            const source = meta('ContentSource') ?? ($('.source').text().replace(/^来源[:：]/, '').trim() || undefined);
            const publishTime = meta('PubDate') ?? ($('.time').text().replace(/^发布时间[:：]/, '').trim() || undefined);

            return { articleTitle, articleText, source, publishTime, attachments };
        } catch (error) {
            logger.error(`getArticleContent error: ${String(error)} articleId=${articleId} channelId=${channelId}`);
            return { articleTitle: '', articleText: '', attachments: [] };
        }
    }

    private async postFormDataApi(url: string, channelId: string, pageNum: number, count: number): Promise<APIData> {
        try {
            const form = new FormData();
            form.append('channelId', channelId);
            form.append('pageNum', pageNum.toString());
            form.append('count', count.toString());
            const res = await defaultAxios.post(url, form);
            return res.data || {};
        } catch (error) {
            logger.error(`postFormDataApi error: ${String(error)} ${url} channelId=${channelId} pageNum=${pageNum} count=${count}`);
            throw error;
        }
    }

    // Ví dụ sử dụng với giá trị cụ thể
    public async getChannelData(url: string, areaKey: string): Promise<INewData[]> {
        const now = Date.now()
        const thresholdTime = now - (8 * 36000 * 1000);
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
                const postTime = new Date(newData.articlePublishTime.replace(' ', 'T') + '+08:00').getTime();
                if (postTime < thresholdTime) {
                    if (newData.isTop) continue;
                    isContinuePost = false;
                    break;
                }
                const { articleTitle, articleText, source, publishTime, attachments } = await this.getArticleContent(newData.articleId, areaKey);
                newDatas.push({ ...newData, articleTitle, articleText, source, publishTime, attachments });
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