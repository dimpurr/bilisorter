// BiliSorter - Unified AI API (Claude + Gemini, parallel batches)

import type { Video, Folder, Suggestion, Settings } from './types';
import { CLAUDE_API_BASE, CLAUDE_API, GEMINI_API_BASE, GEMINI_API, AI_BATCH } from './constants';

// ─── Shared Types ───

interface ClassificationResult {
  bvid: string;
  suggestions: Array<{
    folder_id: number;
    folder_name: string;
    confidence: number;
  }>;
}

// ─── Main Entry Point ───

/**
 * Generate AI suggestions for videos (incremental: skips videos that already have suggestions).
 * Dispatches to Claude or Gemini based on settings.provider.
 * Processes batches in PARALLEL using Promise.allSettled.
 */
export async function generateSuggestions(
  videos: Video[],
  folders: Folder[],
  sourceFolderId: number,
  settings: Settings,
  onProgress?: (completed: number, total: number) => void,
  existingSuggestions?: Record<string, Suggestion[]>
): Promise<{ results: Record<string, Suggestion[]>; failedCount: number }> {
  // Filter out invalid videos and source folder
  const validVideos = videos.filter((v) => v.attr === 0);
  const targetFolders = folders.filter((f) => f.id !== sourceFolderId);

  if (targetFolders.length === 0) {
    throw new Error('没有目标收藏夹');
  }

  if (validVideos.length === 0) {
    throw new Error('没有有效视频');
  }

  // Resolve provider config
  const provider = settings.provider || 'gemini';
  const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.apiKey;
  const model = provider === 'gemini'
    ? (settings.geminiModel || 'gemini-3-flash-preview')
    : (settings.model || 'claude-3-5-haiku-latest');

  if (!apiKey) {
    throw new Error(
      provider === 'gemini'
        ? '请先在设置中配置 Gemini API Key'
        : '请先在设置中配置 Claude API Key'
    );
  }

  // Incremental: skip videos that already have suggestions
  const existing = existingSuggestions || {};
  const videosToProcess = validVideos.filter((v) => !existing[v.bvid]);

  // Start with existing suggestions
  const results: Record<string, Suggestion[]> = { ...existing };

  if (videosToProcess.length === 0) {
    console.log('[AI] All videos already have suggestions, nothing to do');
    return { results, failedCount: 0 };
  }

  console.log(`[AI] Processing ${videosToProcess.length} videos via ${provider}/${model} (${validVideos.length - videosToProcess.length} already done)`);

  // Split into batches
  const batchSize = AI_BATCH.MAX_BATCH_SIZE;
  const batchArrays: Video[][] = [];
  for (let i = 0; i < videosToProcess.length; i += batchSize) {
    batchArrays.push(videosToProcess.slice(i, i + batchSize));
  }

  const totalBatches = batchArrays.length;
  let completedBatches = 0;
  let failedCount = 0;

  // Process ALL batches in parallel
  const batchPromises = batchArrays.map(async (batchVideos, idx) => {
    let retries = 0;
    while (retries <= AI_BATCH.MAX_RETRIES) {
      try {
        const batchResults = await processBatch(
          batchVideos,
          targetFolders,
          apiKey,
          model,
          provider
        );

        // Merge results
        for (const [bvid, suggestions] of Object.entries(batchResults)) {
          results[bvid] = suggestions;
        }

        completedBatches++;
        onProgress?.(completedBatches, totalBatches);
        return; // success
      } catch (error) {
        retries++;
        console.error(`[AI] Batch ${idx + 1} attempt ${retries} failed:`, error);
        if (retries <= AI_BATCH.MAX_RETRIES) {
          const backoff = AI_BATCH.RETRY_BACKOFF_MS * retries;
          console.log(`[AI] Retrying batch ${idx + 1} in ${backoff}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        } else {
          // All retries exhausted
          failedCount += batchVideos.length;
          completedBatches++;
          onProgress?.(completedBatches, totalBatches);
        }
      }
    }
  });

  await Promise.allSettled(batchPromises);

  return { results, failedCount };
}

// ─── Batch Processing ───

async function processBatch(
  videos: Video[],
  folders: Folder[],
  apiKey: string,
  model: string,
  provider: 'gemini' | 'claude'
): Promise<Record<string, Suggestion[]>> {
  const prompt = buildPrompt(videos, folders);
  const systemPrompt = '你是一个视频分类助手。请根据视频标题、UP主、简介、标签等信息，将视频分类到最合适的收藏夹。只返回JSON格式，不要添加任何解释性文字。';

  let response: string;
  if (provider === 'gemini') {
    response = await callGeminiAPI(prompt, systemPrompt, apiKey, model);
  } else {
    response = await callClaudeAPI(prompt, systemPrompt, apiKey, model);
  }

  return parseResponse(response, folders);
}

// ─── Shared: Prompt Building ───

function buildPrompt(videos: Video[], folders: Folder[]): string {
  const folderContext = folders
    .map(
      (f) =>
        `- ${f.name} (ID: ${f.id}, ${f.media_count}个视频)${
          f.sampleTitles.length > 0
            ? '\n  示例: ' + f.sampleTitles.slice(0, 5).join(', ')
            : ''
        }`
    )
    .join('\n');

  const videoContext = videos
    .map((v) => {
      const tags = v.tags?.length > 0 ? `\n  标签: ${v.tags.join(', ')}` : '';
      const intro = v.intro ? `\n  简介: ${v.intro.slice(0, 100)}` : '';
      return `- BVID: ${v.bvid}\n  标题: ${v.title}\n  UP主: ${v.upper.name}${intro}${tags}`;
    })
    .join('\n');

  return `你是一个视频分类助手。请将以下视频分类到最合适的收藏夹中。

## 可用收藏夹

${folderContext}

## 待分类视频

${videoContext}

## 输出格式

请返回JSON格式：
{
  "classifications": [
    {
      "bvid": "视频BVID",
      "suggestions": [
        {"folder_id": 收藏夹ID, "folder_name": "收藏夹名称", "confidence": 0.95},
        ...
      ]
    }
  ]
}

每个视频最多返回5个建议，按置信度从高到低排序。置信度范围0-1，建议阈值：≥0.8高置信度，0.5-0.8中等，<0.5低置信度。`;
}

// ─── Shared: Response Parsing ───

function parseResponse(
  response: string,
  folders: Folder[]
): Record<string, Suggestion[]> {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || response.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch
      ? (jsonMatch[1] || jsonMatch[0])
      : response;

    const data = JSON.parse(jsonStr.trim());

    if (!data.classifications || !Array.isArray(data.classifications)) {
      throw new Error('Invalid response format: missing classifications array');
    }

    const results: Record<string, Suggestion[]> = {};

    for (const classification of data.classifications) {
      const { bvid, suggestions } = classification;

      if (!bvid || !Array.isArray(suggestions)) {
        continue;
      }

      results[bvid] = suggestions
        .filter((s: any) => s.folder_id && s.folder_name)
        .slice(0, 5)
        .map((s: any) => ({
          folderId: s.folder_id,
          folderName: s.folder_name,
          confidence: Math.max(0, Math.min(1, s.confidence || 0)),
        }));
    }

    return results;
  } catch (error) {
    console.error('[AI] Failed to parse response:', error);
    console.error('[AI] Raw response:', response.slice(0, 500));
    return {};
  }
}

// ─── Claude API ───

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callClaudeAPI(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const request: ClaudeRequest = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    system: systemPrompt,
  };

  const response = await fetch(`${CLAUDE_API_BASE}${CLAUDE_API.MESSAGES}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'Anthropic-Version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Claude API error: ${response.status} - ${(errorData as any).error?.message || response.statusText}`
    );
  }

  const data: ClaudeResponse = await response.json();
  return data.content[0]?.text || '';
}

// ─── Gemini API ───

interface GeminiRequest {
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

async function callGeminiAPI(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const request: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const url = `${GEMINI_API_BASE}${GEMINI_API.GENERATE_CONTENT}/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errMsg = (errorData as any)?.error?.message || response.statusText;
    throw new Error(`Gemini API error: ${response.status} - ${errMsg}`);
  }

  const data: GeminiResponse = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini returned no candidates');
  }

  return data.candidates[0].content.parts.map((p) => p.text).join('') || '';
}
