import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Settings, FileCode2, Play, GitMerge, 
  CheckCircle2, ShieldAlert, Key, Link 
} from 'lucide-react';

// API 配置 (前端端口是5173，后端如果是8000，则设置baseURL)
const api = axios.create({
  baseURL: 'http://localhost:8000/api',
});

function App() {
  const [activeTab, setActiveTab] = useState('review');
  const [projectId, setProjectId] = useState('');
  const [mrIid, setMrIid] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const [config, setConfig] = useState({
    active_settings: { provider: 'claude', model_name: '' },
    rules: { default_prompt: '' },
    gitlab: { url: '', private_token: '' },
    credentials: { openai: { api_key: '' }, claude: { api_key: '' }, gemini: { api_key: '' } }
  });

  // 获取配置
  useEffect(() => {
    if (activeTab === 'settings') {
      api.get('/config').then(res => setConfig(res.data)).catch(err => console.log(err));
    }
  }, [activeTab]);

  const triggerReview = async (e) => {
    e.preventDefault();
    if (!projectId || !mrIid) return;
    
    setIsSubmitting(true);
    setMessage(null);
    try {
      await api.post('/review', { 
        project_id: projectId, 
        mr_iid: parseInt(mrIid) 
      });
      setMessage({ type: 'success', text: '审查任务已后台启动，您可以去 GitLab MR 页面刷新查看报告。' });
      setProjectId('');
      setMrIid('');
    } catch (error) {
      setMessage({ type: 'error', text: '请求失败，请确保后端服务 (8000) 正在运行。' });
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
      <main className="w-full max-w-4xl">
        {message && (
          <div className={`mb-6 p-4 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-red-50 text-red-800 border border-red-100'}`}>
            <CheckCircle2 size={20} />
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        )}

        {activeTab === 'review' ? (
          <div className="glass-panel p-8 md:p-10">
            <div className="max-w-xl mx-auto text-center mb-10">
              <h2 className="text-3xl font-semibold tracking-tight mb-3">一键审查 Merge Request</h2>
              <p className="text-gray-500 text-sm">输入 GitLab 的项目 ID 与合并请求 IID，由 AI 在后台深度梳理变更并回评。</p>
            </div>

            <form onSubmit={triggerReview} className="max-w-md mx-auto space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 ml-2">项目 Project ID</label>
                <div className="relative">
                  <FileCode2 className="absolute left-4 top-3.5 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="例如：12345" 
                    className="apple-input pl-11"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 ml-2">Merge Request IID</label>
                <div className="relative">
                  <GitMerge className="absolute left-4 top-3.5 text-gray-400" size={18} />
                  <input 
                    type="number" 
                    value={mrIid}
                    onChange={(e) => setMrIid(e.target.value)}
                    placeholder="例如：88" 
                    className="apple-input pl-11"
                    required
                  />
                </div>
              </div>

              <div className="pt-4">
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full apple-btn justify-center py-3.5"
                >
                  <Play size={18} className={isSubmitting ? 'animate-pulse' : ''} />
                  {isSubmitting ? '正在调起 AI 审查...' : '开始代码审查'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Setting Panel 1 */}
            <div className="glass-panel p-8">
              <div className="flex items-center gap-3 mb-6">
                <Settings className="text-appleBlue" size={24} />
                <h3 className="text-xl font-semibold">大语言模型配置</h3>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">当前首选模型厂商</label>
                  <select 
                    className="apple-input bg-white"
                    value={config.active_settings?.provider || 'openai'}
                    onChange={(e) => setConfig({...config, active_settings: {...config.active_settings, provider: e.target.value}})}
                  >
                    <option value="openai">OpenAI (GPT-4 家族)</option>
                    <option value="claude">Anthropic (Claude 3 家族)</option>
                    <option value="gemini">Google (Gemini 家族)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">模型名称 (Model Name)</label>
                  <input 
                    type="text" 
                    className="apple-input" 
                    value={config.active_settings?.model_name || ''}
                    onChange={(e) => setConfig({...config, active_settings: {...config.active_settings, model_name: e.target.value}})}
                    placeholder="例如：gpt-4o"
                  />
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-600 mb-2 ml-1 flex items-center gap-2">
                    <Key size={14}/> 当前模型的 API Key
                  </label>
                  <input 
                    type="password" 
                    className="apple-input"
                    value={config.credentials?.[config.active_settings?.provider]?.api_key || ''}
                    onChange={(e) => {
                      const p = config.active_settings.provider;
                      setConfig({
                        ...config,
                        credentials: {
                          ...config.credentials,
                          [p]: { ...config.credentials[p], api_key: e.target.value }
                        }
                      });
                    }}
                    placeholder={`sk-${config.active_settings?.provider}-...`}
                  />
                </div>
              </div>
            </div>

            {/* Setting Panel 2 */}
            <div className="glass-panel p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <FileCode2 className="text-appleBlue" size={24} />
                <h3 className="text-xl font-semibold">代码审计规则 (Prompt)</h3>
              </div>
              
              <div className="flex-1 flex flex-col">
                <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">默认系统提示词</label>
                <textarea 
                  className="apple-input flex-1 resize-none py-4 leading-relaxed bg-gray-50/50 block w-full" 
                  value={config.rules?.default_prompt || ''}
                  onChange={(e) => setConfig({...config, rules: {...config.rules, default_prompt: e.target.value}})}
                  placeholder="请输入您的自定义审查要求..."
                />
              </div>

              <div className="mt-6 flex justify-end">
                 <button onClick={handleSaveConfig} disabled={isSubmitting} className="apple-btn px-8">
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
