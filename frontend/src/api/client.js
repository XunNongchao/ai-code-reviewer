/**
 * API 客户端统一配置
 */
import axios from 'axios';

// 动态获取后端地址，支持局域网访问
export const API_BASE = `http://${window.location.hostname}:8000`;

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
});

export default api;
