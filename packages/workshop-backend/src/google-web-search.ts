// Google Search Grounding integration via Gemini API.
// Provides low-cost web search for drama synopses, audience reviews, and online references.

export interface WebSearchOptions {
  query: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface WebSearchSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  query: string;
  summary: string;
  sources: WebSearchSource[];
  searchQueries: string[];
}

const DEFAULT_SEARCH_TIMEOUT_MS = 25_000;
const GEMINI_GROUNDING_MODEL = "gemini-2.5-flash";

export function formatWebSearchResult(result: WebSearchResult): string {
  const lines: string[] = [
    `### 全网检索结果: “${result.query}”`,
    "",
    result.summary.trim(),
  ];

  if (result.sources.length > 0) {
    lines.push("", "#### 参考来源链接：");
    for (const src of result.sources) {
      lines.push(`- [${src.title || src.url}](${src.url})`);
    }
  }

  return lines.join("\n");
}

export async function googleWebSearch(options: WebSearchOptions): Promise<WebSearchResult> {
  const { query, apiKey, timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS, fetchFn = fetch } = options;

  if (!query || query.trim().length === 0) {
    throw new Error("搜索关键词不能为空。");
  }

  if (!apiKey) {
    throw new Error(
      "未检测到 GEMINI_API_KEY 或 GOOGLE_API_KEY。请在环境变量或配置中提供 API Key 以启用网络搜索功能。"
    );
  }

  const prompt = [
    `请联网检索并总结关于“${query.trim()}”的权威与最新资料。`,
    "如果目标是影视剧、短剧、动漫或视频作品，请尽量包含以下结构：",
    "1. 【剧情梗概与故事核】：一句话前提、故事主线与高光情节点",
    "2. 【核心主角与人物关系】：主要角色设定及对立冲突",
    "3. 【全网口碑与用户点评】：豆瓣评分、大众口碑评价，观众的核心爽点与主要槽点",
    "4. 【受众与对标画像】：核心受众圈层与同题材对标作品",
    "如果是其他主题，请客观提炼核心事实、背景及用户真实讨论观点。",
  ].join("\n");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_GROUNDING_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Google Search API 响应异常 (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = (await response.json()) as any;
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      return {
        query,
        summary: "未检索到相关内容或模型未能生成回答。",
        sources: [],
        searchQueries: [],
      };
    }

    const groundingMeta = candidate?.groundingMetadata;
    const searchQueries: string[] = groundingMeta?.webSearchQueries ?? [];
    const sources: WebSearchSource[] = [];

    if (Array.isArray(groundingMeta?.groundingChunks)) {
      for (const chunk of groundingMeta.groundingChunks) {
        if (chunk?.web?.uri) {
          sources.push({
            title: chunk.web.title || chunk.web.uri,
            url: chunk.web.uri,
          });
        }
      }
    }

    // 去重来源链接
    const uniqueSources: WebSearchSource[] = [];
    const seenUrls = new Set<string>();
    for (const src of sources) {
      if (!seenUrls.has(src.url)) {
        seenUrls.add(src.url);
        uniqueSources.push(src);
      }
    }

    return {
      query,
      summary: textPart,
      sources: uniqueSources,
      searchQueries,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`Google Search 检索超时 (${timeoutMs}ms)。请稍后重试。`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
