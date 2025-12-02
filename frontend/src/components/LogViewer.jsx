import { useEffect, useRef } from 'react';
import { Terminal, Wifi, WifiOff, CheckCircle2, XCircle } from 'lucide-react';

/**
 * LogViewer Component
 *
 * Terminal-style log viewer with:
 * - Auto-scroll on new messages
 * - Connection status indicator
 * - Monospace font, dark background
 * - Color coding for stderr
 */
export function LogViewer({ logs, isConnected, isComplete, error }) {
  const containerRef = useRef(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  // Detect if user has scrolled up (disable auto-scroll)
  const handleScroll = () => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    autoScrollRef.current = isAtBottom;
  };

  // Format log line with color coding
  const formatLine = (line, index) => {
    const isStderr = line.startsWith('[stderr]');
    const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('exception');
    const isWarning = line.toLowerCase().includes('warning') || line.toLowerCase().includes('warn');
    const isSuccess = line.includes('exit code: 0') || line.toLowerCase().includes('success');

    let className = 'text-slate-300';
    if (isStderr || isError) className = 'text-red-400';
    else if (isWarning) className = 'text-yellow-400';
    else if (isSuccess) className = 'text-terminal-green';
    else if (line.startsWith('===')) className = 'text-terminal-blue font-semibold';

    return (
      <div
        key={index}
        className={`${className} whitespace-pre-wrap break-all leading-relaxed`}
      >
        {line}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-black rounded-lg border border-slate-800 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-terminal-green" />
          <span className="text-sm font-medium text-slate-400">Output</span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {error ? (
            <div className="flex items-center gap-1.5 text-red-400">
              <XCircle className="w-4 h-4" />
              <span className="text-xs">{error}</span>
            </div>
          ) : isComplete ? (
            <div className="flex items-center gap-1.5 text-terminal-green">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs">Completed</span>
            </div>
          ) : isConnected ? (
            <div className="flex items-center gap-1.5 text-terminal-green">
              <Wifi className="w-4 h-4" />
              <span className="text-xs">Live</span>
              <span className="w-2 h-2 bg-terminal-green rounded-full status-pulse" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-500">
              <WifiOff className="w-4 h-4" />
              <span className="text-xs">Disconnected</span>
            </div>
          )}
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-3 sm:p-4 font-mono text-xs sm:text-sm overscroll-contain touch-pan-y"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <Terminal className="w-10 h-10 sm:w-12 sm:h-12 mb-4 opacity-50" />
            <p>Waiting for output...</p>
            {!isConnected && !error && (
              <p className="text-xs mt-2">Run a job to see logs here</p>
            )}
          </div>
        ) : (
          <>
            {logs.map((line, index) => formatLine(line, index))}
            {/* Blinking cursor when connected and not complete */}
            {isConnected && !isComplete && (
              <span className="terminal-cursor text-terminal-green" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default LogViewer;
