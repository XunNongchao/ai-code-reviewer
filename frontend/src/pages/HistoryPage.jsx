import { useState, useEffect } from 'react';
import { History, Clock, MessageSquare, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { historyApi } from '../api';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  streaming: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const statusLabels = {
  pending: '等待中',
  streaming: '进行中',
  completed: '已完成',
  failed: '失败',
};

function formatTime(timeStr) {
  if (!timeStr) return '-';
  return new Date(timeStr).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function HistoryPage() {
  const [historyList, setHistoryList] = useState([]);
  const [historyDetail, setHistoryDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // 多选相关
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUuids, setSelectedUuids] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const loadHistory = () => {
    setIsLoading(true);
    setHistoryDetail(null);
    historyApi.getList()
      .then(res => setHistoryList(res.data.items || []))
      .catch(err => console.log(err))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const viewDetail = async (sessionUuid) => {
    if (selectMode) return; // 选择模式下不进入详情
    try {
      setIsLoading(true);
      const res = await historyApi.getDetail(sessionUuid);
      setHistoryDetail(res.data);
    } catch (err) {
      console.log(err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (uuid) => {
    setSelectedUuids(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedUuids.size === historyList.length) {
      setSelectedUuids(new Set());
    } else {
      setSelectedUuids(new Set(historyList.map(item => item.session_uuid)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedUuids.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedUuids.size} 条记录？此操作不可恢复。`)) return;

    setIsDeleting(true);
    try {
      await historyApi.deleteSelected([...selectedUuids]);
      setSelectedUuids(new Set());
      setSelectMode(false);
      loadHistory();
    } catch (err) {
      console.error('删除失败:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm('确定清空所有历史记录？此操作不可恢复。')) return;

    setIsDeleting(true);
    try {
      await historyApi.deleteAll();
      setHistoryList([]);
      setSelectMode(false);
      setSelectedUuids(new Set());
    } catch (err) {
      console.error('清空失败:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedUuids(new Set());
  };

  // ========== 详情页 ==========
  if (historyDetail) {
    return (
      <div className="glass-panel p-8 md:p-10">
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <button
            onClick={() => setHistoryDetail(null)}
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

          {historyDetail.merge_request && (
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="text-sm text-gray-500 mb-1">Merge Request</div>
              <div className="font-medium">{historyDetail.project?.project_path} !{historyDetail.merge_request?.mr_iid}</div>
              <div className="text-sm text-gray-600 mt-1">{historyDetail.merge_request?.title}</div>
            </div>
          )}

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
                        <CheckCircle size={12} /> 已发布
                      </span>
                    ) : comment.publish_error ? (
                      <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full">
                        <XCircle size={12} /> 失败
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-full">未发布</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ========== 列表页 ==========
  return (
    <div className="glass-panel p-8 md:p-10">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">审查历史记录</h2>
        {historyList.length > 0 && (
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <button
                  onClick={selectAll}
                  className="text-sm font-medium text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  {selectedUuids.size === historyList.length ? '取消全选' : '全选'}
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedUuids.size === 0 || isDeleting}
                  className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  删除选中 ({selectedUuids.size})
                </button>
                <button
                  onClick={exitSelectMode}
                  className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="text-sm font-medium text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  选择
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  全部清空
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
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
              onClick={() => selectMode ? toggleSelect(item.session_uuid) : viewDetail(item.session_uuid)}
              className={`bg-white border rounded-xl p-4 shadow-sm hover:shadow-md cursor-pointer transition-all ${
                selectedUuids.has(item.session_uuid) ? 'border-appleBlue bg-blue-50/30' : 'border-gray-100 hover:border-blue-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {selectMode && (
                    <div className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedUuids.has(item.session_uuid) ? 'bg-appleBlue border-appleBlue' : 'border-gray-300'
                    }`}>
                      {selectedUuids.has(item.session_uuid) && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800 truncate">{item.project_path}</span>
                      <span className="text-appleBlue flex-shrink-0">!{item.mr_iid}</span>
                    </div>
                    <div className="text-sm text-gray-500 truncate">{item.mr_title || '无标题'}</div>
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
                  <MessageSquare size={12} /> {item.comment_count} 条评论
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle size={12} /> {item.published_count} 已发布
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
