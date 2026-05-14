import { useState, useRef } from 'react';
import {
  Play, GitMerge, CheckCircle2, XCircle, List, Loader2, ChevronUp, ChevronDown
} from 'lucide-react';
import { useMrUrlParser } from '../hooks/useMrUrlParser';
import { executeReview } from '../hooks/useReviewStream';
import DiffViewer from '../components/DiffViewer';

export default function ReviewPage({ onMessage }) {
  const [mrUrlsText, setMrUrlsText] = useState('');
  const { parsedMRs, setParsedMRs, batchMode, setBatchMode } = useMrUrlParser(mrUrlsText);

  const [mrData, setMrData] = useState(null);
  const [aiComments, setAiComments] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentMRIndex, setCurrentMRIndex] = useState(0);
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);

  // 用于中止正在进行的审查请求
  const abortRef = useRef(null);

  // 审查单个 MR
  const reviewSingleMR = async (mrInfo, index) => {
    setParsedMRs(prev => prev.map((mr, i) => i === index ? { ...mr, status: 'loading' } : mr));

    const result = await executeReview(mrInfo.url, {
      signal: abortRef.current?.signal,
      onDiffLoaded: (diffInfo) => {
        setParsedMRs(prev => prev.map((mr, i) =>
          i === index ? { ...mr, status: 'reviewing', mrData: diffInfo } : mr
        ));
        if (!batchMode && index === 0) setMrData(diffInfo);
      },
      onComment: (comment) => {
        setParsedMRs(prev => prev.map((mr, i) =>
          i === index ? { ...mr, aiComments: [...mr.aiComments, comment] } : mr
        ));
        if (!batchMode && index === 0) setAiComments(prev => [...prev, comment]);
      },
      onSessionCreated: (uuid) => {
        setParsedMRs(prev => prev.map((mr, i) =>
          i === index ? { ...mr, sessionUuid: uuid } : mr
        ));
      },
      onStatusMessage: setStatusMessage,
      onError: (msg) => {
        setParsedMRs(prev => prev.map((mr, i) =>
          i === index ? { ...mr, status: 'error', error: msg } : mr
        ));
      },
    });

    if (result.success) {
      setParsedMRs(prev => prev.map((mr, i) =>
        i === index ? { ...mr, status: 'completed' } : mr
      ));
    }
    return result;
  };

  // 触发审查
  const triggerReview = async (e) => {
    e.preventDefault();
    if (parsedMRs.length === 0) {
      onMessage?.({ type: 'error', text: '请输入有效的 GitLab MR URL' });
      return;
    }

    // 创建新的 AbortController
    abortRef.current = new AbortController();

    // 重置状态
    const reviewQueue = parsedMRs.map(mr => ({
      ...mr, status: 'pending', mrData: null, aiComments: [], sessionUuid: null, error: null,
    }));
    setIsSubmitting(true);
    onMessage?.(null);
    setParsedMRs(reviewQueue);
    setCurrentMRIndex(0);
    setAiComments([]);
    setMrData(null);

    if (batchMode && reviewQueue.length > 1) {
      // 真正的批量模式：逐个审查
      setIsFullscreenMode(false);
      let successCount = 0;
      for (let i = 0; i < reviewQueue.length; i++) {
        setCurrentMRIndex(i);
        setStatusMessage(`正在审查第 ${i + 1}/${reviewQueue.length} 个 MR: ${reviewQueue[i].projectPath} !${reviewQueue[i].mrIid}`);
        const result = await reviewSingleMR(reviewQueue[i], i);
        if (result.success) successCount++;
        if (i < reviewQueue.length - 1) await new Promise(r => setTimeout(r, 1000));
      }
      onMessage?.({
        type: successCount === reviewQueue.length ? 'success' : 'warning',
        text: `批量审查完成：${successCount}/${reviewQueue.length} 个 MR 审查成功`,
      });
      setStatusMessage('');
    } else {
      // 单条模式（包括批量列表删到只剩 1 个的情况）
      setBatchMode(false);
      setStatusMessage('分析合并请求地址并请求 MR Diff 数据...');
      setIsFullscreenMode(true);
      const result = await reviewSingleMR(reviewQueue[0], 0);
      onMessage?.({ type: result.success ? 'success' : 'error', text: result.success ? '审查完成' : (result.error || '审查失败') });
      setStatusMessage('');
    }
    setIsSubmitting(false);
  };

  const handleDeleteComment = (comment) => {
    if (batchMode) {
      setParsedMRs(prev => prev.map((mr, i) =>
        i === currentMRIndex ? { ...mr, aiComments: mr.aiComments.filter(c => c !== comment) } : mr
      ));
    } else {
      setAiComments(prev => prev.filter(c => c !== comment));
    }
  };

  // 退出审查，回到首页输入状态
  const exitReview = () => {
    // 中止正在进行的请求
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setMrUrlsText('');
    setParsedMRs([]);
    setBatchMode(false);
    setMrData(null);
    setAiComments([]);
    setStatusMessage('');
    setIsSubmitting(false);
    setIsFullscreenMode(false);
    setCurrentMRIndex(0);
    onMessage?.(null);
  };

  const scrollToNextSuggestion = () => {
    const els = document.querySelectorAll('.ai-suggestion-box');
    for (let el of els) {
      if (el.getBoundingClientRect().top > 120) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  };

  const scrollToPrevSuggestion = () => {
    const els = Array.from(document.querySelectorAll('.ai-suggestion-box')).reverse();
    for (let el of els) {
      if (el.getBoundingClientRect().top < -10) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  };

  const currentReviewMR = batchMode ? parsedMRs[currentMRIndex] : parsedMRs[0];
  const currentReviewData = batchMode ? currentReviewMR?.mrData : mrData;
  const currentReviewComments = batchMode ? (currentReviewMR?.aiComments || []) : aiComments;

  // ========== 全屏模式 ==========
  if (isFullscreenMode) {
    return (
      <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-fade-in-scale">
        {/* Header */}
        <div className="flex items-center justify-between gap-6 px-6 md:px-10 py-5 bg-white border-b border-gray-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-3xl">🔍</span>
              <h3 className="text-2xl md:text-3xl font-semibold text-appleGray-800">AI 审查聚焦模式</h3>
            </div>
            {statusMessage && (
              <div className="hidden md:flex items-center gap-2 text-base text-appleBlue font-medium bg-blue-50 px-5 py-2.5 rounded-full animate-pulse">
                <div className="w-2.5 h-2.5 rounded-full bg-appleBlue"></div>
                {statusMessage}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {currentReviewMR && (
              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-full border border-gray-200">
                <GitMerge size={16} />
                <span className="font-medium">{currentReviewMR.projectPath}</span>
                <span className="text-gray-300">/</span>
                <span className="text-appleBlue font-medium">!{currentReviewMR.mrIid}</span>
              </div>
            )}
            <button
              onClick={() => setIsFullscreenMode(false)}
              className="flex items-center gap-2 text-base font-medium text-gray-600 hover:text-red-500 bg-white px-5 py-2.5 rounded-full transition-all shadow-sm hover:shadow-md border border-gray-200 hover:border-red-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              退出聚焦
            </button>
            <button
              onClick={exitReview}
              className="flex items-center gap-2 text-base font-medium text-white bg-red-500 hover:bg-red-600 px-5 py-2.5 rounded-full transition-all shadow-sm hover:shadow-md"
            >
              结束审查
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-gray-50 px-4 md:px-8 py-6">
          <div className="max-w-full mx-auto">
            {currentReviewData ? (
              <DiffViewer mrData={currentReviewData} aiComments={currentReviewComments} onDeleteComment={handleDeleteComment} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4 py-20">
                <div className="w-16 h-16 relative">
                  <div className="absolute inset-0 rounded-full border-4 border-gray-200"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-appleBlue border-t-transparent animate-spin"></div>
                </div>
                <p className="text-lg font-medium text-gray-600">正在加载代码差异...</p>
              </div>
            )}
          </div>
        </div>

        {/* Floating nav */}
        {currentReviewComments.length > 0 && (
          <>
            <div className="fixed bottom-8 right-8 flex flex-col gap-3 z-50">
              <button onClick={scrollToPrevSuggestion} className="w-14 h-14 bg-white text-appleGray-800 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 flex items-center justify-center transition-all hover:scale-105" title="上一个审查点">
                <ChevronUp size={28} />
              </button>
              <button onClick={scrollToNextSuggestion} className="w-14 h-14 bg-appleBlue text-white rounded-full shadow-lg shadow-appleBlue/30 flex items-center justify-center transition-all hover:scale-105" title="下一个审查点">
                <ChevronDown size={28} />
              </button>
            </div>
            <div className="fixed bottom-8 left-8 bg-white rounded-full shadow-lg border border-gray-200 px-6 py-3 flex items-center gap-3 z-50">
              <span className="text-2xl">💡</span>
              <span className="text-sm font-medium text-gray-700">已生成 <span className="text-appleBlue font-bold text-lg">{currentReviewComments.length}</span> 条审查建议</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // ========== 正常模式 ==========
  return (
    <div className="glass-panel p-6 md:p-8 w-full">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-semibold tracking-tight mb-3">自动化 MR 审查</h2>
        <p className="text-gray-500 text-sm">黏贴 GitLab URL，支持批量审查多个 MR（换行/空格/逗号分隔）</p>
      </div>

      {/* 批量模式 */}
      {batchMode && parsedMRs.length > 0 ? (
        <BatchReviewPanel
          parsedMRs={parsedMRs}
          currentMRIndex={currentMRIndex}
          setCurrentMRIndex={setCurrentMRIndex}
          isSubmitting={isSubmitting}
          statusMessage={statusMessage}
          triggerReview={triggerReview}
          onClear={() => { setMrUrlsText(''); setParsedMRs([]); setBatchMode(false); }}
          onRemoveMR={(index) => {
            const updated = parsedMRs.filter((_, i) => i !== index);
            const updatedText = updated.map(mr => mr.url).join('\n');
            setMrUrlsText(updatedText);
            if (updated.length === 0) {
              setBatchMode(false);
            }
          }}
          onEnterFullscreen={() => setIsFullscreenMode(true)}
          onDeleteComment={handleDeleteComment}
        />
      ) : (
        /* 单个模式 */
        <>
          {isSubmitting || mrData ? (
            <SingleReviewHeader
              mr={parsedMRs[0]}
              onEnterFullscreen={() => setIsFullscreenMode(true)}
              showFullscreen={!!(mrData || aiComments.length > 0)}
            />
          ) : (
            <ReviewInputForm
              mrUrlsText={mrUrlsText}
              setMrUrlsText={setMrUrlsText}
              parsedMRs={parsedMRs}
              isSubmitting={isSubmitting}
              onSubmit={triggerReview}
            />
          )}
        </>
      )}

      {/* 单个模式的 Diff 展示 */}
      {!batchMode && (statusMessage || mrData || isSubmitting) && (
        <div className="mt-8 pt-4 w-full text-left">
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-xl font-semibold flex items-center gap-2 text-appleGray-800">
              <span className="text-2xl">🤖</span> AI 智能代码视图
            </h3>
            <div className="flex items-center gap-3">
              {statusMessage && (
                <div className="flex items-center gap-2 text-sm text-appleBlue font-medium bg-blue-50 px-3 py-1.5 rounded-full animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-appleBlue"></div>
                  {statusMessage}
                </div>
              )}
              {!isSubmitting && (
                <button
                  onClick={exitReview}
                  className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-red-500 bg-white px-4 py-2 rounded-full border border-gray-200 hover:border-red-200 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  结束审查
                </button>
              )}
            </div>
          </div>
          <div className="w-full">
            {mrData ? (
              <DiffViewer mrData={mrData} aiComments={aiComments} onDeleteComment={handleDeleteComment} />
            ) : (
              <div className="text-center py-10 text-gray-400">
                <div className="w-8 h-8 mx-auto mb-3 relative">
                  <div className="absolute inset-0 rounded-full border-2 border-gray-200"></div>
                  <div className="absolute inset-0 rounded-full border-2 border-appleBlue border-t-transparent animate-spin"></div>
                </div>
                <span>正在拉取代码差异...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 子组件
// ============================================================================

function ReviewInputForm({ mrUrlsText, setMrUrlsText, parsedMRs, isSubmitting, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="max-w-xl mx-auto space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2 ml-2 flex items-center justify-between">
          <span>GitLab Merge Request 地址</span>
          {parsedMRs.length > 0 && (
            <span className="text-xs text-appleBlue font-normal">识别到 {parsedMRs.length} 个 MR</span>
          )}
        </label>
        <textarea
          value={mrUrlsText}
          onChange={(e) => setMrUrlsText(e.target.value)}
          placeholder={"例：https://gitlab.../-/merge_requests/3122\n支持多行输入，每行一个 MR 地址\n或用空格、逗号分隔多个 URL"}
          className="apple-input min-h-[120px] resize-y"
          rows={4}
        />
        {parsedMRs.length > 1 && (
          <div className="mt-2 p-3 bg-blue-50 rounded-xl text-sm text-blue-700">
            <div className="flex items-center gap-2 font-medium mb-2">
              <List size={16} /> 将进入批量审查模式
            </div>
            <ul className="space-y-1 ml-5 list-disc text-xs text-blue-600">
              {parsedMRs.slice(0, 3).map((mr, i) => <li key={i}>{mr.projectPath} !{mr.mrIid}</li>)}
              {parsedMRs.length > 3 && <li className="text-blue-500">...还有 {parsedMRs.length - 3} 个</li>}
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
          {isSubmitting ? '启动审查流...' : parsedMRs.length > 1 ? `批量审查 ${parsedMRs.length} 个 MR` : '一键开始审查代码'}
        </button>
      </div>
    </form>
  );
}

function SingleReviewHeader({ mr, onEnterFullscreen, showFullscreen }) {
  if (!mr) return null;
  return (
    <div className="max-w-xl mx-auto flex items-center justify-between bg-white shadow-sm p-4 rounded-2xl border border-gray-100 gap-4 transition-all">
      <div className="flex items-center gap-3 w-full">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-appleBlue">
          <GitMerge size={20} />
        </div>
        <div className="text-left min-w-0 flex-1">
          <div className="text-xs text-gray-400 font-medium mb-0.5">正在审查当前代码合并记录</div>
          <div className="text-sm font-semibold text-gray-700 truncate flex items-center gap-1.5">
            <span className="truncate">{mr.projectPath}</span>
            <span className="text-gray-300 flex-shrink-0">/</span>
            <span className="text-appleBlue flex-shrink-0">!{mr.mrIid}</span>
          </div>
        </div>
        {showFullscreen && (
          <button onClick={onEnterFullscreen} className="flex items-center gap-2 text-sm font-medium text-appleBlue bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-full transition-all hover:scale-105" title="进入聚焦模式">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            聚焦模式
          </button>
        )}
      </div>
    </div>
  );
}

function BatchReviewPanel({ parsedMRs, currentMRIndex, setCurrentMRIndex, isSubmitting, statusMessage, triggerReview, onClear, onRemoveMR, onEnterFullscreen, onDeleteComment }) {
  return (
    <div className="w-full">
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
                mr.status === 'error' ? 'border-red-200 bg-red-50/30' : 'border-gray-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    mr.status === 'completed' ? 'bg-green-100 text-green-600' :
                    mr.status === 'reviewing' || mr.status === 'loading' ? 'bg-blue-100 text-blue-600' :
                    mr.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {mr.status === 'reviewing' || mr.status === 'loading' ? <Loader2 size={20} className="animate-spin" /> :
                     mr.status === 'completed' ? <CheckCircle2 size={20} /> :
                     mr.status === 'error' ? <XCircle size={20} /> : <GitMerge size={20} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800 truncate">{mr.projectPath} !{mr.mrIid}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{mr.aiComments?.length || 0} 条审查建议</div>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  mr.status === 'completed' ? 'bg-green-100 text-green-700' :
                  mr.status === 'reviewing' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                  mr.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {mr.status === 'completed' ? '已完成' : mr.status === 'reviewing' ? '审查中' :
                   mr.status === 'loading' ? '加载中' : mr.status === 'error' ? '失败' : '等待中'}
                </span>
                {!isSubmitting && (mr.status === 'pending' || mr.status === 'error') && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveMR(index); }}
                    className="ml-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="移除此 MR"
                  >
                    <XCircle size={18} />
                  </button>
                )}
              </div>
              {mr.error && <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{mr.error}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      {!isSubmitting && parsedMRs.every(mr => mr.status === 'pending' || mr.status === 'error') && (
        <div className="flex gap-3">
          <button onClick={triggerReview} className="flex-1 apple-btn justify-center py-3.5 shadow-md shadow-appleBlue/20">
            <Play size={18} /> 开始批量审查
          </button>
          <button onClick={onClear} className="px-6 py-3.5 text-gray-600 bg-gray-100 rounded-xl font-medium hover:bg-gray-200 transition-colors">
            清空
          </button>
        </div>
      )}

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
            <button onClick={onClear} className="text-sm text-appleBlue hover:text-blue-600 font-medium">开始新的审查</button>
          </div>
          {/* Tab 切换 */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {parsedMRs.filter(mr => mr.status === 'completed').map((mr, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentMRIndex(parsedMRs.findIndex(m => m === mr))}
                className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  currentMRIndex === parsedMRs.findIndex(m => m === mr) ? 'bg-appleBlue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {mr.projectPath.split('/').pop()} !{mr.mrIid}
              </button>
            ))}
          </div>
          {/* Diff 展示 */}
          {parsedMRs[currentMRIndex]?.status === 'completed' && parsedMRs[currentMRIndex]?.mrData && (
            <>
              <div className="flex justify-end mb-4">
                <button onClick={onEnterFullscreen} className="flex items-center gap-2 text-sm font-medium text-appleBlue bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-full transition-all hover:scale-105">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  聚焦模式
                </button>
              </div>
              <DiffViewer
                mrData={parsedMRs[currentMRIndex].mrData}
                aiComments={parsedMRs[currentMRIndex].aiComments}
                onDeleteComment={onDeleteComment}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
