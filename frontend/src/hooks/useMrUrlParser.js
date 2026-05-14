/**
 * useMrUrlParser - 从文本中解析 GitLab MR URL
 */
import { useState, useEffect } from 'react';

const URL_REGEX = /https?:\/\/[^\s,;，；\n]+?\/-\/merge_requests\/\d+/gi;
const DETAIL_REGEX = /^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/;

/**
 * 从文本中提取并解析所有 GitLab MR URL
 */
function parseMRUrls(text) {
  if (!text || !text.trim()) return [];

  const matches = text.match(URL_REGEX) || [];
  const uniqueUrls = [...new Set(matches.map(url => url.trim()))];

  return uniqueUrls.map(url => {
    const match = url.match(DETAIL_REGEX);
    if (!match) return null;
    return {
      url,
      baseUrl: match[1],
      projectPath: match[2],
      mrIid: match[3],
      status: 'pending',
      mrData: null,
      aiComments: [],
      sessionUuid: null,
      error: null,
    };
  }).filter(Boolean);
}

/**
 * Hook: 监听文本变化，自动解析 MR URL 列表
 */
export function useMrUrlParser(text) {
  const [parsedMRs, setParsedMRs] = useState([]);
  const [batchMode, setBatchMode] = useState(false);

  useEffect(() => {
    const parsed = parseMRUrls(text);
    setParsedMRs(parsed);
    // 只在解析出多个时自动进入批量模式，不自动退出（由用户操作控制）
    if (parsed.length > 1) {
      setBatchMode(true);
    } else if (parsed.length === 0) {
      setBatchMode(false);
    }
  }, [text]);

  return { parsedMRs, setParsedMRs, batchMode, setBatchMode };
}
