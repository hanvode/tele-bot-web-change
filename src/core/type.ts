export interface INewData {
    articleid: string;
    channelId: string;
    articletitle?: string;
    publishtime?: string;
    [key: string]: any;
}

export interface APIData {
    data?: any[];
    list?: INewData[];
    articletitle?: string;
    articlepublishtime?: string;
    articledescription?: string;
    cmsArticleContent?: {
        articlecontent?: string;
    };
    [key: string]: any;
}

export interface IGetApiParams {
    articleId: string;
    channelId: string;
    _: number;
}
