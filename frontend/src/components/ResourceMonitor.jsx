import { useState, useEffect } from 'react';
import { Cpu, HardDrive, MemoryStick, Gpu } from 'lucide-react';
import { getSystemStatus } from '../api';

/**
 * Compact progress bar component
 */
function MiniBar({ percent, color = 'bg-terminal-green' }) {
  return (
    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-300`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

/**
 * ResourceMonitor Component
 *
 * Compact header widget showing system resource usage.
 * Polls the backend every 5 seconds for updated stats.
 */
export function ResourceMonitor() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await getSystemStatus();
        setStatus(data);
        setError(null);
      } catch (e) {
        setError(e.message);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error || !status) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 rounded-lg text-slate-500 text-xs">
        <Cpu className="w-3.5 h-3.5" />
        <span>--</span>
      </div>
    );
  }

  // Determine color based on usage
  const getCpuColor = (percent) => {
    if (percent > 80) return 'bg-red-500';
    if (percent > 60) return 'bg-yellow-500';
    return 'bg-terminal-green';
  };

  const getMemColor = (percent) => {
    if (percent > 85) return 'bg-red-500';
    if (percent > 70) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  return (
    <div className="relative">
      {/* Compact view (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-3 py-1.5 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
      >
        {/* CPU */}
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-300 w-8 text-right">
            {Math.round(status.cpu.percent)}%
          </span>
          <MiniBar percent={status.cpu.percent} color={getCpuColor(status.cpu.percent)} />
        </div>

        {/* Memory */}
        <div className="flex items-center gap-1.5">
          <MemoryStick className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-300 w-8 text-right">
            {Math.round(status.memory.percent)}%
          </span>
          <MiniBar percent={status.memory.percent} color={getMemColor(status.memory.percent)} />
        </div>

        {/* GPU indicator (if available) */}
        {status.gpu && (
          <div className="flex items-center gap-1.5">
            <Gpu className="w-3.5 h-3.5 text-purple-400" />
            {status.gpu.utilization !== null ? (
              <>
                <span className="text-xs text-slate-300 w-8 text-right">
                  {Math.round(status.gpu.utilization)}%
                </span>
                <MiniBar percent={status.gpu.utilization} color="bg-purple-500" />
              </>
            ) : (
              <span className="text-xs text-purple-400">ON</span>
            )}
          </div>
        )}
      </button>

      {/* Expanded view (dropdown) */}
      {expanded && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 p-4 space-y-4">
          {/* CPU Details */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-terminal-green" />
                <span className="text-sm text-slate-300">CPU</span>
              </div>
              <span className="text-sm text-slate-400">{status.cpu.count} cores</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${getCpuColor(status.cpu.percent)} transition-all duration-300`}
                style={{ width: `${status.cpu.percent}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">{Math.round(status.cpu.percent)}% usage</div>
          </div>

          {/* Memory Details */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MemoryStick className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-slate-300">Memory</span>
              </div>
              <span className="text-sm text-slate-400">
                {status.memory.used_gb}GB / {status.memory.total_gb}GB
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${getMemColor(status.memory.percent)} transition-all duration-300`}
                style={{ width: `${status.memory.percent}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">{Math.round(status.memory.percent)}% used</div>
          </div>

          {/* Disk Details */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-slate-300">Disk</span>
              </div>
              <span className="text-sm text-slate-400">
                {status.disk.used_gb}GB / {status.disk.total_gb}GB
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-yellow-500 transition-all duration-300"
                style={{ width: `${status.disk.percent}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">{Math.round(status.disk.percent)}% used</div>
          </div>

          {/* GPU Details */}
          {status.gpu && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Gpu className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-slate-300">GPU</span>
                </div>
              </div>
              <div className="text-xs text-slate-400 truncate">{status.gpu.name}</div>
              {status.gpu.utilization !== null ? (
                <>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden mt-2">
                    <div
                      className="h-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${status.gpu.utilization}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {Math.round(status.gpu.utilization)}% utilization
                    {status.gpu.memory_used !== null && (
                      <span className="ml-2">
                        {status.gpu.memory_used}MB / {status.gpu.memory_total}MB VRAM
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500 mt-1">Available (utilization not tracked)</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {expanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

export default ResourceMonitor;
