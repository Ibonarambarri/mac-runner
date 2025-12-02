import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Terminal, Loader2, Wifi, WifiOff } from 'lucide-react';
import { startTerminalSession } from '../api';
import { useTerminal } from '../hooks/useTerminal';

/**
 * TerminalModal Component
 *
 * Full-screen modal with interactive terminal.
 */
export function TerminalModal({ isOpen, onClose }) {
  const [sessionId, setSessionId] = useState(null);
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const inputRef = useRef(null);
  const outputRef = useRef(null);

  const { output, isConnected, sendCommand, commandHistory, clearOutput, disconnect } = useTerminal(sessionId);

  // Start session when modal opens
  useEffect(() => {
    if (isOpen && !sessionId) {
      setLoading(true);
      setError(null);

      startTerminalSession()
        .then(res => {
          setSessionId(res.session_id);
        })
        .catch(e => {
          setError(e.message);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, sessionId]);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isConnected]);

  // Handle closing
  const handleClose = useCallback(() => {
    disconnect();
    setSessionId(null);
    clearOutput();
    setInput('');
    setHistoryIndex(-1);
    onClose();
  }, [disconnect, clearOutput, onClose]);

  // Handle command submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) {
      sendCommand(input);
      setInput('');
      setHistoryIndex(-1);
    }
  };

  // Handle keyboard navigation for history
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-xl border border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-terminal-green" />
            <span className="font-semibold text-slate-100">Terminal</span>
            {sessionId && (
              <span className="text-xs text-slate-500">Session #{sessionId}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Connection status */}
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-terminal-green" />
                  <span className="text-xs text-terminal-green">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-red-400">Disconnected</span>
                </>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Output area */}
        <div
          ref={outputRef}
          className="flex-1 overflow-y-auto p-4 bg-black font-mono text-sm"
          style={{ minHeight: '300px' }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
            </div>
          ) : error ? (
            <div className="text-red-400">Error: {error}</div>
          ) : output.length === 0 ? (
            <div className="text-slate-500">Waiting for commands...</div>
          ) : (
            output.map((line, index) => (
              <div key={index} className="whitespace-pre-wrap break-all">
                {line.type === 'command' && (
                  <div className="mt-3 mb-1 pt-3 border-t border-slate-800 first:mt-0 first:pt-0 first:border-t-0">
                    <span className="text-terminal-green font-semibold">$ {line.content}</span>
                  </div>
                )}
                {line.type === 'output' && (
                  <span className={line.content.startsWith('[stderr]') ? 'text-red-400' : 'text-slate-300'}>
                    {line.content}
                  </span>
                )}
                {line.type === 'error' && (
                  <span className="text-red-400">{line.content}</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-slate-900/30 p-4 pb-safe">
          <div className="flex items-center gap-3">
            <span className="text-terminal-green font-mono">$</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter command..."
              disabled={!isConnected}
              className="flex-1 bg-transparent text-slate-200 font-mono text-sm placeholder-slate-600 focus:outline-none disabled:opacity-50"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            <button
              type="submit"
              disabled={!isConnected || !input.trim()}
              className="px-4 py-2 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation sm:hidden"
            >
              Run
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Press Enter to run • ↑/↓ for history
          </div>
        </form>
      </div>
    </div>
  );
}
