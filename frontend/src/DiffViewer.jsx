import React, { useState } from 'react';
import parseDiff from 'parse-diff';
import { Play, CheckCircle2, FileCode2, MessagesSquare, CheckCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// API 基础地址 - 动态获取，支持局域网访问
const API_BASE = `http://${window.location.hostname}:8000`;

function CommentBox({ commentData, fileInfo, diffRefs, mrData, row, onApply, onDelete, onPublished }) {
  const [text, setText] = useState(commentData.comment || commentData.comment_text);
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  // 检查是否已发布（从数据库加载的评论有 gitlab_published 字段）
  const isPublished = commentData.gitlab_published === true || commentData.gitlab_published === 1;

  const handleApply = async () => {
    // 如果已发布，不允许再次应用
    if (isPublished || status === 'success') return;

    setStatus('loading');
    try {
      const resp = await fetch(`${API_BASE}/api/mr/publish_note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mrData.url,
          new_path: fileInfo.new_path,
          old_path: fileInfo.old_path,
          new_line: row ? (row.right ? (row.right.ln || row.right.ln2) : null) : (commentData.new_line || commentData.line),
          old_line: row ? (row.left ? (row.left.ln || row.left.ln1) : null) : null,
          comment: text,
          base_sha: diffRefs.base_sha,
          head_sha: diffRefs.head_sha,
          start_sha: diffRefs.start_sha,
          comment_id: commentData.id  // 传递评论 ID 以便更新发布状态
        })
      });
      if (!resp.ok) throw new Error('API Error');
      setStatus('success');
      // 不再重置状态，保持已发布状态
      if (onApply) onApply();
      if (onPublished) onPublished();  // 通知父组件更新状态
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  // 如果已发布，显示只读状态
  if (isPublished || status === 'success') {
    return (
      <div className="bg-green-50 border border-green-200 text-sm rounded-xl p-3">
        <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
          <CheckCircle size={16} /> 已发布到 GitLab
        </div>
        <div className="text-gray-700 whitespace-pre-wrap">{text}</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-blue-200 shadow-[0_2px_8px_-3px_rgba(59,130,246,0.3)] text-sm rounded-xl p-3 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2 text-appleBlue font-medium mb-3">
        <MessagesSquare size={16} /> AI 审查建议
      </div>
      <textarea
        className="w-full text-sm apple-input min-h-[80px]"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="mt-3 flex gap-2 justify-end">
        <button
          onClick={onDelete}
          className="px-4 py-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium text-sm"
        >
          忽略 / 删除
        </button>
        <button
          onClick={handleApply}
          disabled={status === 'loading'}
          className="flex items-center gap-2 bg-black text-white px-5 py-2 rounded-lg font-medium shadow-sm hover:shadow active:scale-95 transition-all text-sm disabled:opacity-50"
        >
          {status === 'loading' ? '提交中...' : '应用此建议'}
        </button>
      </div>
    </div>
  );
}

export default function DiffViewer({ mrData, aiComments, onDeleteComment }) {
  if (!mrData || !mrData.changes) return null;

  const diffRefs = mrData.diff_refs;

  return (
    <div className="flex flex-col gap-6">
      {mrData.changes.map((change, idx) => {
        // Prepend git diff headers for parse-diff
        const fDiff = `--- a/${change.old_path}\n+++ b/${change.new_path}\n${change.diff}`;
        const parsedFiles = parseDiff(fDiff);
        if (!parsedFiles.length) return null;
        const parsed = parsedFiles[0];

        // Gather all AI comments for this file
        // note: AI could output `new_path` or `file`, `new_line` or `line`
        const fileComments = aiComments.filter(c => {
          const pathMatch = (c.new_path === change.new_path) || (c.file === change.new_path);
          return pathMatch;
        });
        const fileHasComments = fileComments.length > 0;

        // Compute rows per chunk
        return (
          <div key={idx} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-200 flex items-center gap-2 text-sm font-medium text-gray-700">
              <FileCode2 size={18} className="text-gray-400" />
              {change.new_path}
            </div>

            {parsed.chunks.map((chunk, cIdx) => {
              const rows = [];
              let pendingDel = [];

              chunk.changes.forEach(ch => {
                if (ch.type === 'del') {
                   pendingDel.push(ch);
                } else if (ch.type === 'add') {
                   if (pendingDel.length > 0) {
                      rows.push({ left: pendingDel.shift(), right: ch });
                   } else {
                      rows.push({ left: null, right: ch });
                   }
                } else {
                   pendingDel.forEach(d => rows.push({ left: d, right: null }));
                   pendingDel = [];
                   rows.push({ left: ch, right: ch });
                }
              });
              pendingDel.forEach(d => rows.push({ left: d, right: null }));

              return (
                <div key={cIdx} className="w-full text-[13px] font-mono leading-relaxed border-b border-gray-100 last:border-0 relative flex flex-col">
                  {/* Hunk Header */}
                  <div className="w-full flex">
                    <div className={`flex ${fileHasComments ? 'w-[70%] border-r border-gray-200' : 'w-full'} bg-blue-50/50 text-blue-400 select-none`}>
                       <div className="w-12 shrink-0 text-center py-1 opacity-60">...</div>
                       <div className="w-12 shrink-0 text-center py-1 opacity-60 border-l border-blue-50">...</div>
                       <div className="flex-1 px-4 py-1.5 opacity-80">{chunk.content}</div>
                    </div>
                    {fileHasComments && (
                       <div className="w-[30%] bg-gray-50 border-b border-gray-100"></div>
                    )}
                  </div>

                  {rows.map((row, rIdx) => {
                     const rightLine = row.right ? (row.right.ln || row.right.ln2) : null;
                     
                     // Find comments for this exact rightline
                     const lineComments = rightLine ? fileComments.filter(c => {
                        const lnMatch = (c.new_line === rightLine) || (c.line === rightLine);
                        return lnMatch;
                     }) : [];

                     return (
                        <div key={rIdx} className="flex flex-row w-full group/row hover:bg-gray-50/50">
                          {/* Code Row */}
                          <div className={`flex min-w-0 border-b border-gray-50/50 ${fileHasComments ? 'w-[70%] border-r border-gray-200' : 'w-full'}`}>
                            {/* Left Side */}
                            <div className={`flex w-1/2 border-r border-gray-100 ${row.left ? (row.left.type === 'del' ? 'bg-red-50/70' : '') : 'bg-gray-50/30'}`}>
                              <div className="w-12 shrink-0 py-0.5 px-2 text-right text-gray-400 select-none border-r border-gray-200 bg-gray-50/60">
                                {row.left ? (row.left.ln || row.left.ln1) : '\u00A0'}
                              </div>
                              <div className={`flex-1 py-0.5 px-4 whitespace-pre-wrap break-all overflow-hidden ${row.left?.type === 'del' ? 'text-red-800' : 'text-gray-700'}`}>
                                {row.left?.content ? row.left.content.substring(1) : ''}
                              </div>
                            </div>
                            
                            {/* Right Side */}
                            <div className={`flex w-1/2 ${row.right ? (row.right.type === 'add' ? 'bg-green-50/70' : '') : 'bg-gray-50/30'}`}>
                              <div className="w-12 shrink-0 py-0.5 px-2 text-right text-gray-400 select-none border-r border-gray-200 bg-gray-50/60 transition-colors group-hover/row:bg-blue-50 cursor-pointer"
                                title="点击在此行添加评论（暂未实现）"
                              >
                                {rightLine || '\u00A0'}
                              </div>
                              <div className={`flex-1 py-0.5 px-4 whitespace-pre-wrap break-all overflow-hidden ${row.right?.type === 'add' ? 'text-green-800' : 'text-gray-700'}`}>
                                {row.right?.content ? row.right.content.substring(1) : ''}
                              </div>
                            </div>
                          </div>

                          {/* AI Comments side for this specific row */}
                          {fileHasComments && (
                             <div className="w-[30%] bg-gray-50 min-w-0 relative border-b border-gray-100/50 flex flex-col justify-center">
                               {lineComments.length > 0 && (
                                  <div className="p-2 flex flex-col gap-2 relative z-10 ai-suggestion-box">
                                     {lineComments.map((commentData, cIdx) => (
                                        <div key={cIdx}>
                                           <CommentBox 
                                             commentData={commentData} 
                                             fileInfo={change}
                                             diffRefs={diffRefs} 
                                             mrData={mrData}
                                             row={row}
                                             onDelete={() => onDeleteComment(commentData)}
                                           />
                                        </div>
                                     ))}
                                  </div>
                               )}
                             </div>
                          )}
                        </div>
                     );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
