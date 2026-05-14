/**
 * useReviewStream - 封装单个 MR 的流式审查逻辑
 *
 * 负责：获取 diff → 触发流式审查 → 解析 SSE → 收集评论 → 保存评论
 * 支持通过 AbortSignal 中止请求。
 */
import { reviewApi, commentApi } from '../api';
import { API_BASE } from '../api/client';

/**
 * 解析 SSE 文本块，提取 data 行
 */
function parseSseLines(text) {
  return text.split('\n\n').filter(line => line.startsWith('data: '));
}

/**
 * 从 JSON Lines buffer 中提取完整的评论对象
 * @returns {{ comments: object[], remaining: string }}
 */
function extractCommentsFromBuffer(buffer) {
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop(); // 最后一行可能不完整
  const comments = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.new_path && (obj.line || obj.new_line)) {
        comments.push(obj);
      }
    } catch {
      // 忽略非法 JSON 行
    }
  }

  return { comments, remaining };
}

/**
 * 执行单个 MR 的完整审查流程
 *
 * @param {string} url - MR URL
 * @param {object} callbacks - 回调函数集合
 * @param {AbortSignal} callbacks.signal - 可选的中止信号
 * @param {function} callbacks.onDiffLoaded - diff 数据加载完成
 * @param {function} callbacks.onComment - 每收到一条新评论
 * @param {function} callbacks.onSessionCreated - session_uuid 创建
 * @param {function} callbacks.onStatusMessage - 状态消息更新
 * @param {function} callbacks.onError - 错误回调
 * @returns {Promise<{ success: boolean, comments: object[], error?: string, aborted?: boolean }>}
 */
export async function executeReview(url, callbacks = {}) {
  const { signal, onDiffLoaded, onComment, onSessionCreated, onStatusMessage, onError } = callbacks;

  try {
    // 检查是否已中止
    if (signal?.aborted) return { success: false, comments: [], aborted: true };

    // 1. 获取 diff 数据
    const diffResp = await fetch(`${API_BASE}/api/mr/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
    if (!diffResp.ok) throw new Error(`HTTP error! status: ${diffResp.status}`);
    const diffInfo = await diffResp.json();
    onDiffLoaded?.({ ...diffInfo, url });

    // 检查是否已中止
    if (signal?.aborted) return { success: false, comments: [], aborted: true };

    // 2. 触发流式审查
    const response = await fetch(`${API_BASE}/api/review/structured_stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let pendingBuffer = '';
    let sessionUuid = null;
    let collectedComments = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        // 检查是否已中止
        if (signal?.aborted) {
          reader.cancel();
          return { success: false, comments: collectedComments, aborted: true };
        }

        const text = decoder.decode(value, { stream: true });
        const sseLines = parseSseLines(text);

        for (const line of sseLines) {
          const dataStr = line.replace('data: ', '');
          if (!dataStr.trim()) continue;

          try {
            const data = JSON.parse(dataStr);

            if (data.status === 'streaming') {
              pendingBuffer += data.chunk;
              const { comments, remaining } = extractCommentsFromBuffer(pendingBuffer);
              pendingBuffer = remaining;

              for (const comment of comments) {
                collectedComments.push(comment);
                onComment?.({ ...comment, gitlab_published: false });
              }
              onStatusMessage?.('大语言模型正在深度分析代码中...');

            } else if (data.status === 'info') {
              if (data.message) onStatusMessage?.(data.message);
              if (data.session_uuid) {
                sessionUuid = data.session_uuid;
                onSessionCreated?.(sessionUuid);
              }

            } else if (data.status === 'error') {
              throw new Error(data.message);

            } else if (data.status === 'done') {
              if (sessionUuid && collectedComments.length > 0) {
                try {
                  await commentApi.saveSessionComments(sessionUuid, collectedComments);
                } catch (err) {
                  console.error('保存评论失败:', err);
                }
              }
            }
          } catch (err) {
            if (err.message && !err.message.includes('Unexpected')) {
              throw err;
            }
          }
        }
      }
    } catch (err) {
      // 如果是中止导致的错误，静默处理
      if (signal?.aborted || err.name === 'AbortError') {
        return { success: false, comments: collectedComments, aborted: true };
      }
      throw err;
    }

    // flush remaining buffer
    if (pendingBuffer.trim()) {
      try {
        const obj = JSON.parse(pendingBuffer);
        if (obj.new_path) {
          collectedComments.push(obj);
          onComment?.({ ...obj, gitlab_published: false });
        }
      } catch {
        // ignore
      }
    }

    return { success: true, comments: collectedComments };

  } catch (error) {
    // 中止错误不算失败，静默返回
    if (error.name === 'AbortError' || signal?.aborted) {
      return { success: false, comments: [], aborted: true };
    }
    onError?.(error.message);
    return { success: false, comments: [], error: error.message };
  }
}
