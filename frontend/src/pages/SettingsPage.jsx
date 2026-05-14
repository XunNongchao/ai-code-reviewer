import { useState, useEffect } from 'react';
import { Settings, Key, FileCode2, GitMerge } from 'lucide-react';
import { configApi } from '../api';

export default function SettingsPage({ onMessage }) {
  const [config, setConfig] = useState({
    llm_config: { provider: 'openai', model_name: '', base_url: '', api_key: '' },
    rules: { default_prompt: '' },
    gitlab: { url: '', private_token: '' },
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    configApi.get()
      .then(res => setConfig(res.data))
      .catch(err => console.log(err));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await configApi.save(config);
      onMessage?.({ type: 'success', text: '配置已更新并保存' });
    } catch {
      onMessage?.({ type: 'error', text: '配置保存失败' });
    }
    setIsSaving(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      <div className="space-y-6">
        {/* LLM Config */}
        <div className="glass-panel p-8">
          <div className="flex items-center gap-3 mb-6">
            <Settings className="text-appleBlue" size={24} />
            <h3 className="text-xl font-semibold">大语言模型配置</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">调用协议 (Protocol)</label>
              <select
                className="apple-input bg-white font-medium"
                value={config.llm_config?.provider || 'openai'}
                onChange={(e) => setConfig({ ...config, llm_config: { ...config.llm_config, provider: e.target.value } })}
              >
                <option value="openai">OpenAI 兼容协议</option>
                <option value="anthropic">Anthropic 协议</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">接口地址 (Base URL)</label>
              <input
                type="text"
                className="apple-input"
                value={config.llm_config?.base_url || ''}
                onChange={(e) => setConfig({ ...config, llm_config: { ...config.llm_config, base_url: e.target.value } })}
                placeholder="例如中转站或智谱: https://open.bigmodel.cn/api/paas/v4"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">模型名称 (Model)</label>
              <input
                type="text"
                className="apple-input"
                value={config.llm_config?.model_name || ''}
                onChange={(e) => setConfig({ ...config, llm_config: { ...config.llm_config, model_name: e.target.value } })}
                placeholder="例如：glm-4 或 gpt-4o-mini"
              />
            </div>
            <div className="pt-4 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-600 mb-2 ml-1 flex items-center gap-2">
                <Key size={14} /> 认证 API Key
              </label>
              <input
                type="password"
                className="apple-input"
                value={config.llm_config?.api_key || ''}
                onChange={(e) => setConfig({ ...config, llm_config: { ...config.llm_config, api_key: e.target.value } })}
                placeholder="sk-..."
              />
            </div>
          </div>
        </div>

        {/* GitLab Config */}
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
                onChange={(e) => setConfig({ ...config, gitlab: { ...config.gitlab, url: e.target.value } })}
                placeholder="例如：https://gitlab.pharmacyyf.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2 ml-1 flex items-center gap-2">
                <Key size={14} /> GitLab Private Token
              </label>
              <input
                type="password"
                className="apple-input"
                value={config.gitlab?.private_token || ''}
                onChange={(e) => setConfig({ ...config, gitlab: { ...config.gitlab, private_token: e.target.value } })}
                placeholder="填写入具有拉取代码与回评权限的 Token"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Prompt Rules */}
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
            onChange={(e) => setConfig({ ...config, rules: { ...config.rules, default_prompt: e.target.value } })}
            placeholder="请输入您的自定义审查要求..."
          />
        </div>
        <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
          <button onClick={handleSave} disabled={isSaving} className="apple-btn px-10">
            {isSaving ? '保存中...' : '保存全局配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
