import React, { useState } from 'react';
import parseDiff from 'parse-diff';
import { Play, CheckCircle2, FileCode2, MessagesSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CommentBox({ commentData, fileInfo, diffRefs, mrData, onApply, onDelete }) {
  const [text, setText] = useState(commentData.comment);
  const [status, setStatus] = useState('idle'); // idle, loading, success, error

  const handleApply = async () => {
    setStatus('loading');
    try {
      const resp = await fetch('http://localhost:8000/api/mr/publish_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mrData.url,
          new_path: fileInfo.new_path,
          old_path: fileInfo.old_path,
          new_line: commentData.new_line || commentData.line,
          comment: text,
          base_sha: diffRefs.base_sha,
          head_sha: diffRefs.head_sha,
          start_sha: diffRefs.start_sha
        })
      });
      if (!resp.ok) throw new Error('API Error');
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
      if (onApply) onApply();
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  return (
    <div className="bg-white border text-sm rounded-xl p-4 shadow-sm my-2 ml-4 mr-4 animate-in fade-in slide-in-from-top-2">
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
          {status === 'loading' ? '提交中...' : status === 'success' ? <><CheckCircle2 size={16}/>已应用至GitLab</> : '应用此建议'}
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
                <div key={cIdx} className="w-full text-[13px] font-mono leading-relaxed border-b border-gray-100 last:border-0 relative">
                  {/* Hunk Header */}
                  <div className="w-full flex bg-blue-50/50 text-blue-400 select-none">
                     <div className="w-12 text-center py-1 opacity-60">...</div>
                     <div className="w-12 text-center py-1 opacity-60 border-l border-blue-50">...</div>
                     <div className="flex-1 px-4 py-1.5 opacity-80">{chunk.content}</div>
                  </div>

                  {rows.map((row, rIdx) => {
                     const rightLine = row.right ? (row.right.ln || row.right.ln2) : null;
                     
                     // Find comments for this exact rightline
                     const lineComments = rightLine ? fileComments.filter(c => {
                        const lnMatch = (c.new_line === rightLine) || (c.line === rightLine);
                        return lnMatch;
                     }) : [];

                     return (
                        <div key={rIdx} className="flex flex-col group/row hover:bg-gray-50/50">
                          {/* Code Row */}
                          <div className="flex w-full min-w-full">
                            {/* Left Side */}
                            <div className={`flex w-1/2 border-r border-gray-100 ${row.left ? (row.left.type === 'del' ? 'bg-red-50/70' : '') : 'bg-gray-50/30'}`}>
                              <div className="w-12 shrink-0 py-0.5 px-2 text-right text-gray-400 select-none border-r border-gray-200 bg-gray-50/60">
                                {row.left ? (row.left.ln || row.left.ln1) : '\u00A0'}
                              </div>
                              <div className={`flex-1 py-0.5 px-4 whitespace-pre-wrap ${row.left?.type === 'del' ? 'text-red-800' : 'text-gray-700'}`}>
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
                              <div className={`flex-1 py-0.5 px-4 whitespace-pre-wrap ${row.right?.type === 'add' ? 'text-green-800' : 'text-gray-700'}`}>
                                {row.right?.content ? row.right.content.substring(1) : ''}
                              </div>
                            </div>
                          </div>

                          {/* AI Comments under the row */}
                          {lineComments.length > 0 && (
                             <div className="col-span-full border-t border-b border-gray-200 bg-gray-50 relative pb-2 pt-1">
                                {lineComments.map((commentData, cIdx) => (
                                  <CommentBox 
                                    key={cIdx} 
                                    commentData={commentData} 
                                    fileInfo={change}
                                    diffRefs={diffRefs} 
                                    mrData={mrData}
                                    onDelete={() => onDeleteComment(commentData)}
                                  />
                                ))}
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
