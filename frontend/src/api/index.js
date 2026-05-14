/**
 * API 接口层 - 统一管理所有后端请求
 */
import api, { API_BASE } from './client';

// ============================================================================
// 配置
// ============================================================================

export const configApi = {
  get: () => api.get('/config'),
  save: (configData) => api.post('/config', { config_data: configData }),
};

// ============================================================================
// 审查
// ============================================================================

export const reviewApi = {
  /** 获取 MR diff 数据 */
  getMrDiff: async (url) => {
    const resp = await fetch(`${API_BASE}/api/mr/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
    return resp.json();
  },

  /** 获取结构化流式审查的 ReadableStream reader */
  getStructuredStreamReader: async (url) => {
    const response = await fetch(`${API_BASE}/api/review/structured_stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.body.getReader();
  },
};

// ============================================================================
// 评论
// ============================================================================

export const commentApi = {
  /** 保存会话评论 */
  saveSessionComments: (sessionUuid, comments) =>
    api.post('/session/comments', {
      session_uuid: sessionUuid,
      comments: comments.map(c => ({
        new_path: c.new_path,
        old_path: c.old_path,
        new_line: c.new_line || c.line,
        old_line: c.old_line,
        comment: c.comment,
      })),
    }),

  /** 发布评论到 GitLab */
  publishNote: (payload) =>
    fetch(`${API_BASE}/api/mr/publish_note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};

// ============================================================================
// 历史记录
// ============================================================================

export const historyApi = {
  getList: (limit = 50) => api.get(`/history?limit=${limit}`),
  getDetail: (sessionUuid) => api.get(`/history/${sessionUuid}`),
  deleteAll: () => api.delete('/history'),
  deleteSelected: (sessionUuids) => api.post('/history/delete', { session_uuids: sessionUuids }),
};
