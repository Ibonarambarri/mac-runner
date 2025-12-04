import { useState } from 'react';
import { Play, Zap } from 'lucide-react';
import { runOneOffCommand } from '../api';

/**
 * QuickRun Component
 *
 * Run one-off commands without saving them as templates.
 */
export function QuickRun({ projectId, onJobStarted, onCommandsChange, disabled }) {
  const [quickCommand, setQuickCommand] = useState('');
  const [runningQuick, setRunningQuick] = useState(false);
  const [error, setError] = useState(null);

  const handleRunQuick = async (e) => {
    e.preventDefault();
    if (!quickCommand.trim()) return;

    setRunningQuick(true);
    setError(null);

    try {
      const job = await runOneOffCommand(projectId, quickCommand.trim());
      setQuickCommand('');
      if (onJobStarted) {
        onJobStarted(job);
      }
      if (onCommandsChange) {
        onCommandsChange();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunningQuick(false);
    }
  };

  return (
    <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-yellow-400" />
        <h2 className="text-sm font-semibold text-slate-400">Quick Run</h2>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-xs">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:text-red-300">
            ×
          </button>
        </div>
      )}

      <form onSubmit={handleRunQuick} className="flex gap-2">
        <input
          type="text"
          value={quickCommand}
          onChange={(e) => setQuickCommand(e.target.value)}
          placeholder="Run any command once..."
          disabled={disabled}
          className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-yellow-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || runningQuick || !quickCommand.trim()}
          className="px-4 py-2 bg-yellow-500/20 text-yellow-400 text-sm rounded-lg hover:bg-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 touch-manipulation"
        >
          {runningQuick ? (
            <span className="animate-spin">...</span>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run
            </>
          )}
        </button>
      </form>
    </section>
  );
}

export default QuickRun;
