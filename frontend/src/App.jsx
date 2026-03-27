import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Settings, FileCode2, Play, GitMerge,
  CheckCircle2, ShieldAlert, Key, Link,
  ArrowUp, ChevronDown, ChevronUp, History,
  Clock, MessageSquare, CheckCircle, XCircle,
  List, ChevronRight, Loader2
} from 'lucide-react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DiffViewer from './DiffViewer';

// API 配置 - 动态获取后端地址，支持局域网访问
const API_BASE = `http://${window.location.hostname}:8000`;
const api = axios.create({
  baseURL: `${API_BASE}/api`,
});

function App() {
  const [activeTab, setActiveTab] = useState('review');
  const [mrUrlsText, setMrUrlsText] = useState('');  // textarea 内容
  const [parsedMRs, setParsedMRs] = useState([]);     // 解析后的 MR 列表
  const [mrData, setMrData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const [aiComments, setAiComments] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentSessionUuid, setCurrentSessionUuid] = useState(null);

  // 批量审查相关状态
  const [batchMode, setBatchMode] = useState(false);           // 是否批量模式
  const [currentMRIndex, setCurrentMRIndex] = useState(0);     // 当前查看的 MR 索引

  // 历史记录相关状态
  const [historyList, setHistoryList] = useState([]);
  const [historyDetail, setHistoryDetail] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [config, setConfig] = useState({
    llm_config: { provider: 'openai', model_name: '', base_url: '', api_key: '' },
    rules: { default_prompt: '' },
    gitlab: { url: '', private_token: '' }
  });

  // URL 解析函数：从文本中提取所有 GitLab MR URL
  const parseMRUrls = (text) => {
    if (!text || !text.trim()) return [];

    // 正则匹配 GitLab MR URL: https://gitlab.example.com/group/project/-/merge_requests/123
    const urlRegex = /https?:\/\/[^\s,;，；\n]+?\/-\/merge_requests\/\d+/gi;
    const matches = text.match(urlRegex) || [];

    // 去重
    const uniqueUrls = [...new Set(matches.map(url => url.trim()))];

    // 解析每个 URL 提取信息
    return uniqueUrls.map(url => {
      const match = url.match(/^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
      if (match) {
        return {
          url: url,
          baseUrl: match[1],
          projectPath: match[2],
          mrIid: match[3],
          status: 'pending', // pending, loading, reviewing, completed, error
          mrData: null,
          aiComments: [],
          sessionUuid: null,
          error: null
        };
      }
      return null;
    }).filter(Boolean);
  };

  // 当 textarea 内容变化时解析 URL
  useEffect(() => {
    const parsed = parseMRUrls(mrUrlsText);
    setParsedMRs(parsed);
    setBatchMode(parsed.length > 1);
  }, [mrUrlsText]);

  const scrollToNextSuggestion = () => {
    const els = document.querySelectorAll('.ai-suggestion-box');
    if (!els.length) return;
    for (let el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.top > 120) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  };

  const scrollToPrevSuggestion = () => {
    const els = Array.from(document.querySelectorAll('.ai-suggestion-box')).reverse();
    if (!els.length) return;
    for (let el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.top < -10) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 获取配置
  useEffect(() => {
    if (activeTab === 'settings') {
      api.get('/config').then(res => setConfig(res.data)).catch(err => console.log(err));
    }
  }, [activeTab]);

  // 获取历史记录
  useEffect(() => {
    if (activeTab === 'history') {
      setIsLoadingHistory(true);
      setHistoryDetail(null);
      api.get('/history?limit=50')
        .then(res => setHistoryList(res.data.items || []))
        .catch(err => console.log(err))
        .finally(() => setIsLoadingHistory(false));
    }
  }, [activeTab]);

  // 查看历史详情
  const viewHistoryDetail = async (sessionUuid) => {
    try {
      setIsLoadingHistory(true);
      const res = await api.get(`/history/${sessionUuid}`);
      setHistoryDetail(res.data);
    } catch (err) {
      console.log(err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // 返回历史列表
  const backToHistoryList = () => {
    setHistoryDetail(null);
  };

  // 格式化时间
  const formatTime = (timeStr) => {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 状态颜色映射
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    streaming: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800'
  };

  const statusLabels = {
    pending: '等待中',
    streaming: '进行中',
    completed: '已完成',
    failed: '失败'
  };

  // 审查单个 MR 的函数
  const reviewSingleMR = async (mrInfo, index) => {
    const url = mrInfo.url;

    try {
      // 更新状态为 loading
      setParsedMRs(prev => prev.map((mr, i) =>
        i === index ? { ...mr, status: 'loading' } : mr
      ));

      // 1. 获取 diff 数据
      const diffResp = await fetch(`${API_BASE}/api/mr/diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!diffResp.ok) throw new Error(`HTTP error! status: ${diffResp.status}`);
      const diffInfo = await diffResp.json();

      // 更新状态为 reviewing
      setParsedMRs(prev => prev.map((mr, i) =>
        i === index ? { ...mr, status: 'reviewing', mrData: { ...diffInfo, url } } : mr
      ));

      // 2. 触发流式审查
      const response = await fetch(`${API_BASE}/api/review/structured_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let pendingBuffer = '';
      let sessionUuid = null;
      let collectedComments = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });

        const lines = text.split('\n\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '');
            if (!dataStr.trim()) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.status === 'streaming') {
                pendingBuffer += data.chunk;
                const jsonLines = pendingBuffer.split(/\r?\n/);
                pendingBuffer = jsonLines.pop();

                for (const jLine of jsonLines) {
                  if (!jLine.trim()) continue;
                  try {
                    const parsedObj = JSON.parse(jLine);
                    if (parsedObj.new_path && (parsedObj.line || parsedObj.new_line)) {
                      collectedComments.push(parsedObj);
                      // 更新该 MR 的评论
                      setParsedMRs(prev => prev.map((mr, i) =>
                        i === index
                          ? { ...mr, aiComments: [...mr.aiComments, { ...parsedObj, gitlab_published: false }] }
                          : mr
                      ));
                    }
                  } catch (e) { }
                }
              } else if (data.status === 'info') {
                if (data.session_uuid) {
                  sessionUuid = data.session_uuid;
                  setParsedMRs(prev => prev.map((mr, i) =>
                    i === index ? { ...mr, sessionUuid } : mr
                  ));
                }
              } else if (data.status === 'error') {
                throw new Error(data.message);
              } else if (data.status === 'done') {
                // 保存评论到数据库
                if (sessionUuid && collectedComments.length > 0) {
                  try {
                    await api.post('/session/comments', {
                      session_uuid: sessionUuid,
                      comments: collectedComments.map(c => ({
                        new_path: c.new_path,
                        old_path: c.old_path,
                        new_line: c.new_line || c.line,
                        old_line: c.old_line,
                        comment: c.comment
                      }))
                    });
                  } catch (err) {
                    console.error('保存评论失败:', err);
                  }
                }
              }
            } catch (err) {
              console.error("解析SSE出错", err);
            }
          }
        }
      }

      // flush remaining buffer
      if (pendingBuffer.trim()) {
        try {
          const parsedObj = JSON.parse(pendingBuffer);
          if (parsedObj.new_path) {
            collectedComments.push(parsedObj);
            setParsedMRs(prev => prev.map((mr, i) =>
              i === index
                ? { ...mr, aiComments: [...mr.aiComments, { ...parsedObj, gitlab_published: false }] }
                : mr
            ));
          }
        } catch (e) { }
      }

      // 最终保存评论
      if (sessionUuid && collectedComments.length > 0) {
        try {
          await api.post('/session/comments', {
            session_uuid: sessionUuid,
            comments: collectedComments.map(c => ({
              new_path: c.new_path,
              old_path: c.old_path,
              new_line: c.new_line || c.line,
              old_line: c.old_line,
              comment: c.comment
            }))
          });
        } catch (err) {
          console.error('保存评论失败:', err);
        }
      }

      // 更新状态为 completed
      setParsedMRs(prev => prev.map((mr, i) =>
        i === index ? { ...mr, status: 'completed' } : mr
      ));

      return { success: true, comments: collectedComments };
    } catch (error) {
      // 更新状态为 error
      setParsedMRs(prev => prev.map((mr, i) =>
        i === index ? { ...mr, status: 'error', error: error.message } : mr
      ));
      return { success: false, error: error.message };
    }
  };

  // 批量审查入口函数
  const triggerReview = async (e) => {
    e.preventDefault();

    if (parsedMRs.length === 0) {
      setMessage({ type: 'error', text: '请输入有效的 GitLab MR URL' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setBatchResults([]);
    setReviewProgress({ current: 0, total: parsedMRs.length });

    if (batchMode) {
      // 批量模式：逐个审查
      for (let i = 0; i < parsedMRs.length; i++) {
        setCurrentMRIndex(i);
        setReviewProgress({ current: i + 1, total: parsedMRs.length });
        setStatusMessage(`正在审查第 ${i + 1}/${parsedMRs.length} 个 MR: ${parsedMRs[i].projectPath} !${parsedMRs[i].mrIid}`);

        const result = await reviewSingleMR(parsedMRs[i], i);
        setBatchResults(prev => [...prev, result]);

        // 每个审查完成后短暂暂停，避免 API 限流
        if (i < parsedMRs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const successCount = parsedMRs.filter(mr => mr.status === 'completed').length;
      setMessage({
        type: successCount === parsedMRs.length ? 'success' : 'warning',
        text: `批量审查完成：${successCount}/${parsedMRs.length} 个 MR 审查成功`
      });
      setStatusMessage('');
    } else {
      // 单个模式：保持原有流程
      const singleMR = parsedMRs[0];
      setStatusMessage('分析合并请求地址并请求 MR Diff 数据...');

      const result = await reviewSingleMR(singleMR, 0);

      if (result.success) {
        // 单个模式时同步状态到原有变量
        setMrData(singleMR.mrData);
        setAiComments(singleMR.aiComments);
        setCurrentSessionUuid(singleMR.sessionUuid);
        setMessage({ type: 'success', text: '审查完成' });
      } else {
        setMessage({ type: 'error', text: result.error || '审查失败' });
      }
      setStatusMessage('');
    }

    setIsSubmitting(false);
  };

  const handleSaveConfig = async () => {
    setIsSubmitting(true);
    try {
      await api.post('/config', { config_data: config });
      setMessage({ type: 'success', text: '配置已更新并保存至 config.toml' });
    } catch (error) {
      setMessage({ type: 'error', text: '配置保存失败' });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-appleGray-50 py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center selection:bg-blue-100">
      
      {/* Header */}
      <div className="w-full max-w-4xl flex items-center justify-between mb-10">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 text-appleBlue">
             <ShieldAlert size={28} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-appleGray-800">AI Code Reviewer</h1>
            <p className="text-sm text-gray-500 font-medium mt-0.5">智能代码审查助手</p>
          </div>
        </div>

        {/* Apple Style Tabs */}
        <div className="flex bg-gray-200/50 p-1 rounded-full items-center">
          <button
            onClick={() => setActiveTab('review')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${activeTab === 'review' ? 'bg-white shadow-sm text-appleGray-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            工作台
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${activeTab === 'history' ? 'bg-white shadow-sm text-appleGray-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <History size={16} />
            历史记录
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${activeTab === 'settings' ? 'bg-white shadow-sm text-appleGray-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            系统设置
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="w-full max-w-6xl">
        {message && (
          <div className={`mb-6 p-4 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-red-50 text-red-800 border border-red-100'}`}>
            <CheckCircle2 size={20} />
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        )}

        {activeTab === 'review' ? (
          <div className="glass-panel p-8 md:p-10">
            <div>
              <div className="max-w-xl mx-auto text-center mb-8">
                <h2 className="text-3xl font-semibold tracking-tight mb-3">自动化 MR 审查</h2>
                <p className="text-gray-500 text-sm">黏贴 GitLab URL，支持批量审查多个 MR（换行/空格/逗号分隔）</p>
              </div>

              {/* 批量模式：显示 MR 列表 */}
              {batchMode && parsedMRs.length > 0 ? (
                <div className="max-w-3xl mx-auto">
                  {/* MR 列表 */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <List size={20} className="text-appleBlue" />
                        识别到 {parsedMRs.length} 个 Merge Request
                      </h3>
                      {isSubmitting && (
                        <div className="text-sm text-appleBlue font-medium">
                          审查中... {parsedMRs.filter(mr => mr.status === 'completed').length}/{parsedMRs.length}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {parsedMRs.map((mr, index) => (
                        <div
                          key={index}
                          onClick={() => !isSubmitting && mr.status === 'completed' && setCurrentMRIndex(index)}
                          className={`bg-white border rounded-xl p-4 transition-all ${
                            mr.status === 'completed' ? 'cursor-pointer hover:shadow-md border-green-200' :
                            mr.status === 'reviewing' ? 'border-blue-300 bg-blue-50/30' :
                            mr.status === 'error' ? 'border-red-200 bg-red-50/30' :
                            'border-gray-100'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                                mr.status === 'completed' ? 'bg-green-100 text-green-600' :
                                mr.status === 'reviewing' || mr.status === 'loading' ? 'bg-blue-100 text-blue-600' :
                                mr.status === 'error' ? 'bg-red-100 text-red-600' :
                                'bg-gray-100 text-gray-400'
                              }`}>
                                {mr.status === 'reviewing' || mr.status === 'loading' ? (
                                  <Loader2 size={20} className="animate-spin" />
                                ) : mr.status === 'completed' ? (
                                  <CheckCircle2 size={20} />
                                ) : mr.status === 'error' ? (
                                  <XCircle size={20} />
                                ) : (
                                  <GitMerge size={20} />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-gray-800 truncate">
                                  {mr.projectPath} !{mr.mrIid}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {mr.aiComments?.length || 0} 条审查建议
                                </div>
                              </div>
                            </div>
                            <div className="flex-shrink-0 ml-4">
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                mr.status === 'completed' ? 'bg-green-100 text-green-700' :
                                mr.status === 'reviewing' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                                mr.status === 'loading' ? 'bg-blue-100 text-blue-700' :
                                mr.status === 'error' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {mr.status === 'completed' ? '已完成' :
                                 mr.status === 'reviewing' ? '审查中' :
                                 mr.status === 'loading' ? '加载中' :
                                 mr.status === 'error' ? '失败' : '等待中'}
                              </span>
                            </div>
                          </div>
                          {mr.error && (
                            <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                              {mr.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  {!isSubmitting && parsedMRs.every(mr => mr.status === 'pending' || mr.status === 'error') && (
                    <div className="flex gap-3">
                      <button
                        onClick={triggerReview}
                        className="flex-1 apple-btn justify-center py-3.5 shadow-md shadow-appleBlue/20"
                      >
                        <Play size={18} />
                        开始批量审查
                      </button>
                      <button
                        onClick={() => {
                          setMrUrlsText('');
                          setParsedMRs([]);
                          setBatchMode(false);
                        }}
                        className="px-6 py-3.5 text-gray-600 bg-gray-100 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                      >
                        清空
                      </button>
                    </div>
                  )}

                  {/* 审查中显示进度 */}
                  {isSubmitting && statusMessage && (
                    <div className="flex items-center justify-center gap-3 text-appleBlue bg-blue-50 px-4 py-3 rounded-xl">
                      <Loader2 size={18} className="animate-spin" />
                      <span className="text-sm font-medium">{statusMessage}</span>
                    </div>
                  )}

                  {/* 审查完成后显示结果 */}
                  {!isSubmitting && parsedMRs.some(mr => mr.status === 'completed') && (
                    <div className="mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">审查结果</h3>
                        <button
                          onClick={() => {
                            setMrUrlsText('');
                            setParsedMRs([]);
                            setBatchMode(false);
                          }}
                          className="text-sm text-appleBlue hover:text-blue-600 font-medium"
                        >
                          开始新的审查
                        </button>
                      </div>

                      {/* Tab 切换查看不同 MR */}
                      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                        {parsedMRs.filter(mr => mr.status === 'completed').map((mr, idx) => (
                          <button
                            key={idx}
                            onClick={() => setCurrentMRIndex(parsedMRs.findIndex(m => m === mr))}
                            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              currentMRIndex === parsedMRs.findIndex(m => m === mr)
                                ? 'bg-appleBlue text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {mr.projectPath.split('/').pop()} !{mr.mrIid}
                          </button>
                        ))}
                      </div>

                      {/* 显示当前选中 MR 的 Diff */}
                      {parsedMRs[currentMRIndex]?.status === 'completed' && parsedMRs[currentMRIndex]?.mrData && (
                        <DiffViewer
                          mrData={parsedMRs[currentMRIndex].mrData}
                          aiComments={parsedMRs[currentMRIndex].aiComments}
                          onDeleteComment={(comment) => {
                            setParsedMRs(prev => prev.map((mr, i) =>
                              i === currentMRIndex
                                ? { ...mr, aiComments: mr.aiComments.filter(c => c !== comment) }
                                : mr
                            ));
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* 单个模式或未开始 */
                <>
                  {isSubmitting || mrData ? (
                    <div className="max-w-xl mx-auto flex flex-col sm:flex-row items-center justify-between bg-white shadow-sm p-4 rounded-2xl border border-gray-100 gap-4 transition-all animate-in fade-in zoom-in duration-300">
                       <div className="flex items-center gap-3 w-full">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-appleBlue">
                            <GitMerge size={20} />
                          </div>
                          <div className="text-left min-w-0 flex-1">
                             <div className="text-xs text-gray-400 font-medium mb-0.5">正在审查当前代码合并记录</div>
                             <div className="text-sm font-semibold text-gray-700 truncate w-full flex items-center gap-1.5">
                                <span className="truncate">{parsedMRs[0]?.projectPath}</span>
                                <span className="text-gray-300 flex-shrink-0">/</span>
                                <span className="text-appleBlue flex-shrink-0">!{parsedMRs[0]?.mrIid}</span>
                             </div>
                          </div>
                       </div>
                    </div>
                  ) : (
                    <form onSubmit={triggerReview} className="max-w-xl mx-auto space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 ml-2 flex items-center justify-between">
                           <span>GitLab Merge Request 地址</span>
                           {parsedMRs.length > 0 && (
                             <span className="text-xs text-appleBlue font-normal">
                               识别到 {parsedMRs.length} 个 MR
                             </span>
                           )}
                        </label>
                        <div className="relative">
                          <textarea
                            value={mrUrlsText}
                            onChange={(e) => setMrUrlsText(e.target.value)}
                            placeholder="例：https://gitlab.../-/merge_requests/3122&#10;支持多行输入，每行一个 MR 地址&#10;或用空格、逗号分隔多个 URL"
                            className="apple-input min-h-[120px] resize-y"
                            rows={4}
                          />
                        </div>
                        {parsedMRs.length > 1 && (
                          <div className="mt-2 p-3 bg-blue-50 rounded-xl text-sm text-blue-700">
                            <div className="flex items-center gap-2 font-medium mb-2">
                              <List size={16} />
                              将进入批量审查模式
                            </div>
                            <ul className="space-y-1 ml-5 list-disc text-xs text-blue-600">
                              {parsedMRs.slice(0, 3).map((mr, i) => (
                                <li key={i}>{mr.projectPath} !{mr.mrIid}</li>
                              ))}
                              {parsedMRs.length > 3 && (
                                <li className="text-blue-500">...还有 {parsedMRs.length - 3} 个</li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div className="pt-4">
                        <button
                          type="submit"
                          disabled={isSubmitting || parsedMRs.length === 0}
                          className="w-full apple-btn justify-center py-3.5 shadow-md shadow-appleBlue/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Play size={18} className={isSubmitting ? 'animate-pulse' : ''} />
                          {isSubmitting ? '启动审查流...' :
                           parsedMRs.length > 1 ? `批量审查 ${parsedMRs.length} 个 MR` :
                           '一键开始审查代码'}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>

            {/* 单个模式的 Diff 展示 */}
            {!batchMode && (statusMessage || mrData || isSubmitting) && (
              <div className="mt-8 pt-4 w-full text-left animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-4 px-2 max-w-2xl mx-auto">
                   <h3 className="text-xl font-semibold flex items-center gap-2 text-appleGray-800">
                     <span className="text-2xl">🤖</span> AI 智能代码视图
                   </h3>
                   {statusMessage && (
                     <div className="flex items-center gap-2 text-sm text-appleBlue font-medium bg-blue-50 px-3 py-1.5 rounded-full animate-pulse">
                        <div className="w-2 h-2 rounded-full bg-appleBlue"></div>
                        {statusMessage}
                     </div>
                   )}
                </div>
                
                <div className="w-full">
                   {mrData ? (
                      <DiffViewer 
                        mrData={mrData} 
                        aiComments={aiComments} 
                        onDeleteComment={(comment) => setAiComments(prev => prev.filter(c => c !== comment))}
                      />
                   ) : (
                     <div className="relative overflow-hidden group max-w-2xl mx-auto">
                       <div className="absolute inset-0 bg-gradient-to-tr from-blue-50/50 to-white pointer-events-none rounded-3xl" />
                       <div className="relative z-10 text-[15px] text-gray-700 bg-white/60 backdrop-blur-sm shadow-sm p-6 sm:p-8 rounded-3xl border border-gray-100 min-h-[160px]">
                           <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3 py-10">
                              <div className="w-8 h-8 relative">
                                 <div className="absolute inset-0 rounded-full border-2 border-gray-200"></div>
                                 <div className="absolute inset-0 rounded-full border-2 border-appleBlue border-t-transparent animate-spin"></div>
                              </div>
                              <span>正在拉取代码差异...</span>
                           </div>
                       </div>
                     </div>
                   )}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'history' ? (
          <div className="glass-panel p-8 md:p-10">
            {/* 历史记录页面 */}
            {historyDetail ? (
              /* 历史详情 */
              <div className="animate-in fade-in slide-in-from-bottom-4">
                <button
                  onClick={backToHistoryList}
                  className="mb-6 text-appleBlue hover:text-blue-600 flex items-center gap-2 text-sm font-medium"
                >
                  ← 返回历史列表
                </button>

                <div className="mb-6">
                  <h2 className="text-2xl font-semibold mb-2">审查详情</h2>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock size={14} />
                      {formatTime(historyDetail.session?.started_at)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[historyDetail.session?.status]}`}>
                      {statusLabels[historyDetail.session?.status]}
                    </span>
                    <span>{historyDetail.session?.provider} / {historyDetail.session?.model_name}</span>
                  </div>
                </div>

                {/* MR 信息 */}
                {historyDetail.merge_request && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-6">
                    <div className="text-sm text-gray-500 mb-1">Merge Request</div>
                    <div className="font-medium">{historyDetail.project?.project_path} !{historyDetail.merge_request?.mr_iid}</div>
                    <div className="text-sm text-gray-600 mt-1">{historyDetail.merge_request?.title}</div>
                  </div>
                )}

                {/* 发布统计 */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-appleBlue">{historyDetail.publish_stats?.total || 0}</div>
                    <div className="text-xs text-gray-500">总评论数</div>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{historyDetail.publish_stats?.published || 0}</div>
                    <div className="text-xs text-gray-500">已发布</div>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{historyDetail.publish_stats?.failed || 0}</div>
                    <div className="text-xs text-gray-500">发布失败</div>
                  </div>
                </div>

                {/* 评论列表 */}
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <MessageSquare size={18} />
                  审查评论 ({historyDetail.comments?.length || 0})
                </h3>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {historyDetail.comments?.map((comment, idx) => (
                    <div key={idx} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono text-appleBlue truncate mb-1">
                            {comment.new_path}
                            {comment.new_line && <span className="text-gray-400">:{comment.new_line}</span>}
                          </div>
                          <div className="text-sm text-gray-700">{comment.comment_text}</div>
                        </div>
                        <div className="flex-shrink-0">
                          {comment.gitlab_published ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                              <CheckCircle size={12} />
                              已发布
                            </span>
                          ) : comment.publish_error ? (
                            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full">
                              <XCircle size={12} />
                              失败
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-full">
                              未发布
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* 历史列表 */
              <div>
                <h2 className="text-2xl font-semibold mb-6">审查历史记录</h2>

                {isLoadingHistory ? (
                  <div className="text-center py-12 text-gray-400">
                    <div className="w-10 h-10 mx-auto mb-4 relative">
                      <div className="absolute inset-0 rounded-full border-2 border-gray-200"></div>
                      <div className="absolute inset-0 rounded-full border-2 border-appleBlue border-t-transparent animate-spin"></div>
                    </div>
                    加载中...
                  </div>
                ) : historyList.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <History size={48} className="mx-auto mb-4 opacity-30" />
                    <p>暂无审查记录</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {historyList.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => viewHistoryDetail(item.session_uuid)}
                        className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-100 cursor-pointer transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-800 truncate">
                                {item.project_path}
                              </span>
                              <span className="text-appleBlue flex-shrink-0">!{item.mr_iid}</span>
                            </div>
                            <div className="text-sm text-gray-500 truncate">
                              {item.mr_title || '无标题'}
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right ml-4">
                            <div className={`inline-block px-2 py-0.5 rounded-full text-xs ${statusColors[item.status]}`}>
                              {statusLabels[item.status]}
                            </div>
                            <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 justify-end">
                              <Clock size={12} />
                              {formatTime(item.started_at)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                          <span>{item.provider} / {item.model_name}</span>
                          <span className="flex items-center gap-1">
                            <MessageSquare size={12} />
                            {item.comment_count} 条评论
                          </span>
                          <span className="flex items-center gap-1">
                            <CheckCircle size={12} />
                            {item.published_count} 已发布
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            
            <div className="space-y-6">
              {/* Setting Panel 1: LLM Config */}
              <div className="glass-panel p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Settings className="text-appleBlue" size={24} />
                  <h3 className="text-xl font-semibold">大语言模型配置</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">后端大模型 Provider (接入协议)</label>
                    <select 
                      className="apple-input bg-white font-medium"
                      value={config.llm_config?.provider || 'openai'}
                      onChange={(e) => setConfig({
                        ...config, 
                        llm_config: { ...config.llm_config, provider: e.target.value }
                      })}
                    >
                      <option value="openai">OpenAI (官方接口)</option>
                      <option value="anthropic">Anthropic (官方接口)</option>
                      <option value="custom">Custom (兼容 OpenAI 格式的中转站/代理/智谱API)</option>
                    </select>
                  </div>

                  <div>
                     <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">接口地址 (Base URL)</label>
                     <div className="relative">
                        <input 
                          type="text" 
                          className="apple-input" 
                          value={config.llm_config?.base_url || ''}
                          onChange={(e) => setConfig({
                            ...config, 
                            llm_config: { ...config.llm_config, base_url: e.target.value }
                          })}
                          placeholder="例如中转站或智谱: https://open.bigmodel.cn/api/paas/v4"
                        />
                     </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">模型名称 (Model)</label>
                    <input 
                      type="text" 
                      className="apple-input" 
                      value={config.llm_config?.model_name || ''}
                      onChange={(e) => setConfig({
                        ...config, 
                        llm_config: { ...config.llm_config, model_name: e.target.value }
                      })}
                      placeholder="例如：glm-4 或 gpt-4o-mini"
                    />
                  </div>

                  <div className="pt-4 border-t border-gray-100">
                    <label className="block text-sm font-medium text-gray-600 mb-2 ml-1 flex items-center gap-2">
                      <Key size={14}/> 认证 API Key
                    </label>
                    <input 
                      type="password" 
                      className="apple-input"
                      value={config.llm_config?.api_key || ''}
                      onChange={(e) => setConfig({
                        ...config, 
                        llm_config: { ...config.llm_config, api_key: e.target.value }
                      })}
                      placeholder={`sk-...`}
                    />
                  </div>
                </div>
              </div>

              {/* Setting Panel 3: GitLab Config */}
              <div className="glass-panel p-8">
                <div className="flex items-center gap-3 mb-6">
                  <GitMerge className="text-appleBlue" size={24} />
                  <h3 className="text-xl font-semibold">GitLab 私有库配置</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">GitLab 实例地址</label>
                    <input 
                      type="url" 
                      className="apple-input" 
                      value={config.gitlab?.url || ''}
                      onChange={(e) => setConfig({
                        ...config, 
                        gitlab: { ...config.gitlab, url: e.target.value }
                      })}
                      placeholder="例如：https://gitlab.pharmacyyf.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2 ml-1 flex items-center gap-2">
                      <Key size={14}/> GitLab Private Token
                    </label>
                    <input 
                      type="password" 
                      className="apple-input" 
                      value={config.gitlab?.private_token || ''}
                      onChange={(e) => setConfig({
                        ...config, 
                        gitlab: { ...config.gitlab, private_token: e.target.value }
                      })}
                      placeholder="填写入具有拉取代码与回评权限的 Token"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Setting Panel 2: Prompt Rules */}
            <div className="glass-panel p-8 flex flex-col h-full">
              <div className="flex items-center gap-3 mb-6">
                <FileCode2 className="text-appleBlue" size={24} />
                <h3 className="text-xl font-semibold">代码审计规则 (Prompt)</h3>
              </div>
              
              <div className="flex-1 flex flex-col">
                <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">默认系统提示词</label>
                <textarea 
                  className="apple-input flex-1 resize-y min-h-[300px] py-4 leading-relaxed bg-gray-50/50 block w-full" 
                  value={config.rules?.default_prompt || ''}
                  onChange={(e) => setConfig({...config, rules: {...config.rules, default_prompt: e.target.value}})}
                  placeholder="请输入您的自定义审查要求..."
                />
              </div>

              <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                 <button onClick={handleSaveConfig} disabled={isSubmitting} className="apple-btn px-10">
                   {isSubmitting ? '保存中...' : '保存全局配置'}
                 </button>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Floating navigation buttons */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-3 z-50">
         {(aiComments.length > 0) && (
           <>
             <button onClick={scrollToPrevSuggestion} className="w-12 h-12 bg-white text-appleGray-800 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 flex items-center justify-center animate-in fade-in slide-in-from-bottom-4 transition-all" title="上一个审查点">
                <ChevronUp size={24} />
             </button>
             <button onClick={scrollToNextSuggestion} className="w-12 h-12 bg-white text-appleGray-800 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 flex items-center justify-center animate-in fade-in slide-in-from-bottom-4 transition-all" title="下一个审查点">
                <ChevronDown size={24} />
             </button>
           </>
         )}
         <button onClick={scrollToTop} className="w-12 h-12 bg-white text-appleGray-800 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 flex items-center justify-center transition-all hover:scale-105 active:scale-95" title="回到顶部">
            <ArrowUp size={24} />
         </button>
      </div>

    </div>
  );
}

export default App;
