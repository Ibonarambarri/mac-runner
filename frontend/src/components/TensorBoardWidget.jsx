import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Play, Square, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { detectTensorboardDirs, startTensorboard, stopTensorboard, getTensorboardStatus } from '../api';

/**
 * TensorBoardWidget Component
 *
 * Shows detected TensorBoard log directories and allows launching TensorBoard.
 * Displayed in the Files tab when log directories are detected.
 */
export function TensorBoardWidget({ projectId }) {
  const [directories, setDirectories] = useState([]);
  const [running, setRunning] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(null);
  const [error, setError] = useState(null);

  // Fetch TensorBoard directories and status
  const fetchData = useCallback(async () => {
    try {
      const [dirsData, statusData] = await Promise.all([
        detectTensorboardDirs(projectId),
        getTensorboardStatus(projectId)
      ]);
      setDirectories(dirsData.directories || []);
      setRunning(statusData.running || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();

    // Poll status every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Start TensorBoard
  const handleStart = async (logDir) => {
    setStarting(logDir);
    setError(null);
    try {
      const result = await startTensorboard(projectId, logDir);
      if (result.url) {
        // Open in new tab
        window.open(result.url, '_blank');
      }
      await fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(null);
    }
  };

  // Stop TensorBoard
  const handleStop = async (logDir) => {
    try {
      await stopTensorboard(projectId, logDir);
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  // Check if a directory has a running server
  const getRunningInfo = (logDir) => {
    return running.find(r => r.log_dir === logDir);
  };

  if (loading) {
    return null; // Don't show anything while loading
  }

  if (directories.length === 0 && running.length === 0) {
    return null; // Don't show if no TensorBoard directories detected
  }

  return (
    <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-orange-500/20">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-medium text-orange-300">TensorBoard</span>
        </div>
        <button
          onClick={fetchData}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="p-3 space-y-2">
        {directories.map((dir) => {
          const runningInfo = getRunningInfo(dir.path);
          const isStarting = starting === dir.path;

          return (
            <div
              key={dir.path}
              className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-300 truncate">{dir.name}/</div>
                  <div className="text-xs text-slate-500 truncate">{dir.path}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-2">
                {runningInfo ? (
                  <>
                    <a
                      href={runningInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded text-xs hover:bg-orange-500/30 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open
                    </a>
                    <button
                      onClick={() => handleStop(dir.path)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30 transition-colors"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleStart(dir.path)}
                    disabled={isStarting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green/20 text-terminal-green rounded text-xs hover:bg-terminal-green/30 transition-colors disabled:opacity-50"
                  >
                    {isStarting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Launch
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Show running servers that might not be in directories list */}
        {running
          .filter(r => !directories.some(d => d.path === r.log_dir))
          .map((r) => (
            <div
              key={r.log_dir}
              className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-300 truncate">{r.log_dir}</div>
                  <div className="text-xs text-orange-400">Running on port {r.port}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-2">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded text-xs hover:bg-orange-500/30 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
                <button
                  onClick={() => handleStop(r.log_dir)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30 transition-colors"
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export default TensorBoardWidget;
