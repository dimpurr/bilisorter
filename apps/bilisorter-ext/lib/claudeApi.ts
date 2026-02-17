// BiliSorter - Claude API Functions

import type { Video, Folder, Suggestion } from './types';
import { CLAUDE_API_BASE, CLAUDE_API, AI_BATCH } from './constants';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ClassificationResult {
  bvid: string;
  suggestions: Array<{
    folder_id: number;
    folder_name: string;
    confidence: number;
  }>;
}

/**
 * Generate AI suggestions for videos
 */
export async function generateSuggestions(
  videos: Video[],
  folders: Folder[],
  sourceFolderId: number,
  apiKey: string,
  model: string,
  onProgress?: (completed: number, total: number) => void
): Promise<Record<string, Suggestion[]>> {
  // Filter out invalid videos and source folder
  const validVideos = videos.filter((v) => v.attr === 0);
  const targetFolders = folders.filter((f) => f.id !== sourceFolderId);

  if (targetFolders.length === 0) {
    throw new Error('没有目标收藏夹');
  }

  if (validVideos.length === 0) {
    throw new Error('没有有效视频');
  }

  const results: Record<string, Suggestion[]> = {};
  const batchSize = AI_BATCH.MAX_BATCH_SIZE;
  const batches = Math.ceil(validVideos.length / batchSize);

  for (let i = 0; i < batches; i++) {
    const batchVideos = validVideos.slice(i * batchSize, (i + 1) * batchSize);

    try {
      const batchResults = await processBatch(
        batchVideos,
        targetFolders,
        apiKey,
        model
      );

      // Merge results
      for (const [bvid, suggestions] of Object.entries(batchResults)) {
        results[bvid] = suggestions;
      }

      onProgress?.(i + 1, batches);

      // Delay between batches
      if (i < batches - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, AI_BATCH.INTER_BATCH_DELAY_MS)
        );
      }
    } catch (error) {
      console.error(`[ClaudeAPI] Batch ${i + 1} failed:`, error);
      // Continue with next batch
    }
  }

  return results;
}

/**
 * Process a single batch of videos
 */
async function processBatch(
  videos: Video[],
  folders: Folder[],
  apiKey: string,
  model: string
): Promise<Record<string, Suggestion[]>> {
  const prompt = buildPrompt(videos, folders);

  const response = await callClaudeAPI(prompt, apiKey, model);

  return parseResponse(response, folders);
}

/**
 * Build the prompt for Claude
 */
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
      const tags = v.tags?.length > 0 ? ` [标签: ${v.tags.join(', ')}]` : '';
      return `- BVID: ${v.bvid}\n  标题: ${v.title}\n  UP主: ${v.upper.name}${tags}`;
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

/**
 * Call Claude API
 */
async function callClaudeAPI(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const request: ClaudeRequest = {
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    system:
      '你是一个视频分类助手。请根据视频标题、UP主、标签等信息，将视频分类到最合适的收藏夹。只返回JSON格式，不要添加任何解释性文字。',
  };

  const response = await fetch(`${CLAUDE_API_BASE}${CLAUDE_API.MESSAGES}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'Anthropic-Version': '2023-06-01',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Claude API error: ${response.status} - ${errorData.error?.message || response.statusText}`
    );
  }

  const data: ClaudeResponse = await response.json();
  return data.content[0]?.text || '';
}

/**
 * Parse Claude response
 */
function parseResponse(
  response: string,
  folders: Folder[]
): Record<string, Suggestion[]> {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const data = JSON.parse(jsonMatch[0]);

    if (!data.classifications || !Array.isArray(data.classifications)) {
      throw new Error('Invalid response format');
    }

    const results: Record<string, Suggestion[]> = {};

    for (const classification of data.classifications) {
      const { bvid, suggestions } = classification;

      if (!bvid || !Array.isArray(suggestions)) {
        continue;
      }

      // Map suggestions and validate folder names
      results[bvid] = suggestions
        .filter((s) => s.folder_id && s.folder_name)
        .slice(0, 5)
        .map((s) => ({
          folderId: s.folder_id,
          folderName: s.folder_name,
          confidence: Math.max(0, Math.min(1, s.confidence || 0)),
        }));
    }

    return results;
  } catch (error) {
    console.error('[ClaudeAPI] Failed to parse response:', error);
    return {};
  }
}
