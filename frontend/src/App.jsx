import { useState } from 'react';
import { History, CheckCircle2, ArrowUp } from 'lucide-react';
import ReviewPage from './pages/ReviewPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import Logo from './components/Logo';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('review');
  const [message, setMessage] = useState(null);

  return (
    <div className="min-h-screen bg-appleGray-50 py-8 px-4 sm:px-6 lg:px-10 flex flex-col items-center selection:bg-blue-100">
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 text-appleBlue">
            <Logo size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-appleGray-800">AI Code Reviewer</h1>
            <p className="text-sm text-gray-500 font-medium mt-0.5">智能代码审查助手</p>
          </div>
        </div>

        {/* Tabs */}
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

      {/* Message Banner */}
      <main className="w-full">
        {message && (
          <div className={`mb-6 p-4 rounded-2xl flex items-center gap-3 ${
            message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-100' :
            message.type === 'warning' ? 'bg-yellow-50 text-yellow-800 border border-yellow-100' :
            'bg-red-50 text-red-800 border border-red-100'
          }`}>
            <CheckCircle2 size={20} />
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        )}

        <div className={activeTab === 'review' ? '' : 'hidden'}><ReviewPage onMessage={setMessage} /></div>
        <div className={activeTab === 'history' ? '' : 'hidden'}><HistoryPage /></div>
        <div className={activeTab === 'settings' ? '' : 'hidden'}><SettingsPage onMessage={setMessage} /></div>
      </main>

      {/* 回到顶部 */}
      <div className="fixed bottom-8 right-8 z-50">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="px-5 h-12 bg-white text-appleGray-800 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95"
          title="回到顶部"
        >
          <ArrowUp size={20} />
          <span className="text-sm font-medium pr-1">回到顶部</span>
        </button>
      </div>
    </div>
  );
}

export default App;
