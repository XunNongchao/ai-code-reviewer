import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Settings, FileCode2, Play, GitMerge, 
  CheckCircle2, ShieldAlert, Key, Link
} from 'lucide-react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DiffViewer from './DiffViewer';

// API 配置 (前端端口是5173，后端如果是8000，则设置baseURL)
const api = axios.create({
  baseURL: 'http://localhost:8000/api',
});

function App() {
  const [activeTab, setActiveTab] = useState('review');
  const [mrUrl, setMrUrl] = useState('');
  const [parsedMR, setParsedMR] = useState(null);
  const [mrData, setMrData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  
  const [aiComments, setAiComments] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');

  const [config, setConfig] = useState({
    llm_config: { provider: 'openai', model_name: '', base_url: '', api_key: '' },
    rules: { default_prompt: '' },
    gitlab: { url: '', private_token: '' }
  });

  // 获取配置
  useEffect(() => {
    if (activeTab === 'settings') {
      api.get('/config').then(res => setConfig(res.data)).catch(err => console.log(err));
    }
  }, [activeTab]);

  const triggerReview = async (e) => {
    e.preventDefault();
    if (!mrUrl) return;
    
    // 解析 URL
    const match = mrUrl.match(/^(https?:\/\/[^\/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
    if (match) {
      setParsedMR({ projectId: match[2], mrIid: match[3] });
    } else {
      setParsedMR({ projectId: '未知项目', mrIid: '未知ID' });
    }

    setIsSubmitting(true);
    setMessage(null);
    setAiComments([]);
    setMrData(null);
    setStatusMessage('分析合并请求地址并请求 MR Diff 数据...');
    
    try {
      // 1. 获取 diff 数据
      const diffResp = await fetch('http://localhost:8000/api/mr/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mrUrl }),
      });
      if (!diffResp.ok) throw new Error(`HTTP error! status: ${diffResp.status}`);
      const diffInfo = await diffResp.json();
      setMrData({ ...diffInfo, url: mrUrl });

      // 2. 触发流式审查
      setStatusMessage('正在由大语言模型逐行扫描代码...');
      const response = await fetch('http://localhost:8000/api/review/structured_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mrUrl }),
      });
      
      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let pendingBuffer = '';

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
                 // accumulated buffer for json lines
                 pendingBuffer += data.chunk;
                 const jsonLines = pendingBuffer.split(/\r?\n/);
                 // keep the last potentially incomplete line in buffer
                 pendingBuffer = jsonLines.pop(); 
                 
                 for (const jLine of jsonLines) {
                     if (!jLine.trim()) continue;
                     try {
                        const parsedObj = JSON.parse(jLine);
                        if (parsedObj.new_path && (parsedObj.line || parsedObj.new_line)) {
                           // add valid comment to state
                           setAiComments(prev => [...prev, parsedObj]);
                        }
                     } catch(e) { } // ignore incomplete json line parser errors
                 }
                 setStatusMessage('大语言模型正在深度分析代码中...');
              } else if (data.status === 'info') {
                setStatusMessage(data.message);
              } else if (data.status === 'error') {
                setMessage({ type: 'error', text: data.message });
                setIsSubmitting(false);
                setStatusMessage('');
                return;
              } else if (data.status === 'done') {
                setMessage({ type: 'success', text: data.message });
                setStatusMessage('');
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
            if (parsedObj.new_path) setAiComments(prev => [...prev, parsedObj]);
         } catch(e) {}
      }
    } catch (error) {
      setMessage({ type: 'error', text: '网络请求失败，请确保后端服务 (8000) 正在运行。' });
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
                <p className="text-gray-500 text-sm">黏贴 GitLab URL，无需繁琐人工操作，后端直连自动拉取 Diff 分析并回评</p>
              </div>

              {isSubmitting || mrData ? (
                <div className="max-w-xl mx-auto flex flex-col sm:flex-row items-center justify-between bg-white shadow-sm p-4 rounded-2xl border border-gray-100 gap-4 transition-all animate-in fade-in zoom-in duration-300">
                   <div className="flex items-center gap-3 w-full">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-appleBlue">
                        <GitMerge size={20} />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                         <div className="text-xs text-gray-400 font-medium mb-0.5">正在审查当前代码合并记录</div>
                         <div className="text-sm font-semibold text-gray-700 truncate w-full flex items-center gap-1.5">
                            <span className="truncate">{parsedMR?.projectId}</span>
                            <span className="text-gray-300 flex-shrink-0">/</span>
                            <span className="text-appleBlue flex-shrink-0">!{parsedMR?.mrIid}</span>
                         </div>
                      </div>
                   </div>
                </div>
              ) : (
                <form onSubmit={triggerReview} className="max-w-xl mx-auto space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 ml-2 flex items-center justify-between">
                       <span>GitLab Merge Request 地址</span>
                    </label>
                    <div className="relative">
                      <input 
                        type="url" 
                        value={mrUrl}
                        onChange={(e) => setMrUrl(e.target.value)}
                        placeholder="例：https://gitlab.../-/merge_requests/3122" 
                        className="apple-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="w-full apple-btn justify-center py-3.5 shadow-md shadow-appleBlue/20"
                    >
                      <Play size={18} className={isSubmitting ? 'animate-pulse' : ''} />
                      {isSubmitting ? '启动审查流...' : '一键开始审查代码'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {(statusMessage || mrData || isSubmitting) && (
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

    </div>
  );
}

export default App;
