import { useEffect, useRef, useState, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Terminal, Wifi, WifiOff, CheckCircle2, XCircle, ChevronDown, X } from 'lucide-react';

/**
 * LogViewer Component
 *
 * Terminal-style log viewer with virtualization for performance:
 * - Uses react-virtuoso for efficient rendering of thousands of lines
 * - Smart auto-scroll (stops when user scrolls up, resumes at bottom)
 * - "New logs" indicator when auto-scroll is paused
 * - Connection status indicator
 * - Monospace font, dark background
 * - Color coding for stderr, errors, warnings
 */
export function LogViewer({ logs, isConnected, isComplete, error, jobId, onClear }) {
  const virtuosoRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showNewLogsButton, setShowNewLogsButton] = useState(false);
  const prevLogsLengthRef = useRef(logs.length);

  // Track when new logs arrive while not at bottom
  useEffect(() => {
    if (logs.length > prevLogsLengthRef.current && !atBottom) {
      setShowNewLogsButton(true);
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs.length, atBottom]);

  // Auto-scroll to bottom when new logs arrive (if at bottom)
  useEffect(() => {
    if (atBottom && virtuosoRef.current && logs.length > 0) {
      virtuosoRef.current.scrollToIndex({
        index: logs.length - 1,
        align: 'end',
        behavior: 'auto'
      });
      setShowNewLogsButton(false);
    }
  }, [logs.length, atBottom]);

  // Handle at-bottom state changes
  const handleAtBottomStateChange = useCallback((bottom) => {
    setAtBottom(bottom);
    if (bottom) {
      setShowNewLogsButton(false);
    }
  }, []);

  // Scroll to bottom and re-enable auto-scroll
  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && logs.length > 0) {
      virtuosoRef.current.scrollToIndex({
        index: logs.length - 1,
        align: 'end',
        behavior: 'smooth'
      });
      setAtBottom(true);
      setShowNewLogsButton(false);
    }
  }, [logs.length]);

  // Format log line with color coding
  const formatLine = useCallback((line) => {
    const isStderr = line.startsWith('[stderr]');
    const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('exception');
    const isWarning = line.toLowerCase().includes('warning') || line.toLowerCase().includes('warn');
    const isSuccess = line.includes('exit code: 0') || line.toLowerCase().includes('success');

    let className = 'text-slate-300';
    if (isStderr || isError) className = 'text-red-400';
    else if (isWarning) className = 'text-yellow-400';
    else if (isSuccess) className = 'text-terminal-green';
    else if (line.startsWith('===')) className = 'text-terminal-blue font-semibold';

    return className;
  }, []);

  // Render individual log line
  const renderLogLine = useCallback((index) => {
    const line = logs[index];
    const className = formatLine(line);

    return (
      <div
        className={`${className} whitespace-pre-wrap break-all leading-relaxed px-3 sm:px-4 py-0.5`}
      >
        {line}
      </div>
    );
  }, [logs, formatLine]);

  return (
    <div className="flex flex-col h-full bg-black rounded-lg border border-slate-800 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-terminal-green" />
          <span className="text-sm font-medium text-slate-400">
            {jobId ? `Job #${jobId}` : 'Output'}
          </span>
          {logs.length > 0 && (
            <span className="text-xs text-slate-600">
              ({logs.length.toLocaleString()} lines)
            </span>
          )}
        </div>

        {/* Status indicator and clear button */}
        <div className="flex items-center gap-3">
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

          {/* Clear button */}
          {jobId && onClear && (
            <button
              onClick={onClear}
              className="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
              title="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Log content - Virtualized */}
      <div className="relative flex-1">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <Terminal className="w-10 h-10 sm:w-12 sm:h-12 mb-4 opacity-50" />
            <p>Waiting for output...</p>
            {!isConnected && !error && (
              <p className="text-xs mt-2">Run a job to see logs here</p>
            )}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            totalCount={logs.length}
            itemContent={renderLogLine}
            followOutput="auto"
            atBottomStateChange={handleAtBottomStateChange}
            atBottomThreshold={100}
            overscan={200}
            className="font-mono text-xs sm:text-sm"
            components={{
              Footer: () => (
                // Blinking cursor when connected and not complete
                isConnected && !isComplete ? (
                  <div className="px-3 sm:px-4 py-0.5">
                    <span className="terminal-cursor text-terminal-green" />
                  </div>
                ) : null
              )
            }}
          />
        )}

        {/* New logs indicator button */}
        {showNewLogsButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-terminal-green text-slate-950 rounded-full text-sm font-medium shadow-lg hover:bg-terminal-green/90 transition-all animate-bounce"
          >
            <ChevronDown className="w-4 h-4" />
            New logs
          </button>
        )}
      </div>
    </div>
  );
}

export default LogViewer;
