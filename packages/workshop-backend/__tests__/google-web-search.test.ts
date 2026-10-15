import { describe, it, expect, vi } from "vitest";
import {
  googleWebSearch,
  formatWebSearchResult,
  type WebSearchResult,
} from "../src/google-web-search";

describe("googleWebSearch", () => {
  it("should throw error if query is empty", async () => {
    await expect(googleWebSearch({ query: "   ", apiKey: "test-key" })).rejects.toThrow(
      "搜索关键词不能为空。"
    );
  });

  it("should throw error if apiKey is missing", async () => {
    await expect(googleWebSearch({ query: "墨雨云间" })).rejects.toThrow(
      "未检测到 GEMINI_API_KEY 或 GOOGLE_API_KEY"
    );
  });

  it("should successfully parse grounded search results and sources", async () => {
    const mockResponseData = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: "《墨雨云间》是一部古装复仇悬疑剧，改编自千山茶客小说《嫡嫁千金》。主要讲述薛芳菲在遭受陷害后重生的复仇故事。观众普遍称赞节奏紧凑、爽点密集，豆瓣好评集中在快节奏复仇爽感。",
              },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ["墨雨云间 剧情梗概", "墨雨云间 豆瓣短评"],
            groundingChunks: [
              {
                web: {
                  uri: "https://movie.douban.com/subject/36154128/",
                  title: "墨雨云间 (豆瓣)",
                },
              },
              {
                web: {
                  uri: "https://movie.douban.com/subject/36154128/", // 重复链接，应去重
                  title: "墨雨云间 再次匹配",
                },
              },
              {
                web: {
                  uri: "https://baike.baidu.com/item/墨雨云间",
                  title: "墨雨云间_百度百科",
                },
              },
            ],
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    });

    const result = await googleWebSearch({
      query: "墨雨云间",
      apiKey: "fake-api-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.query).toBe("墨雨云间");
    expect(result.summary).toContain("薛芳菲");
    expect(result.sources).toHaveLength(2); // 已去重
    expect(result.sources[0].title).toBe("墨雨云间 (豆瓣)");
    expect(result.searchQueries).toEqual(["墨雨云间 剧情梗概", "墨雨云间 豆瓣短评"]);

    // 格式化测试
    const formatted = formatWebSearchResult(result);
    expect(formatted).toContain("### 全网检索结果: “墨雨云间”");
    expect(formatted).toContain("[墨雨云间 (豆瓣)](https://movie.douban.com/subject/36154128/)");
  });

  it("should handle HTTP errors gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden: Invalid API Key",
    });

    await expect(
      googleWebSearch({
        query: "测试剧集",
        apiKey: "bad-key",
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow("Google Search API 响应异常 (403)");
  });
});
