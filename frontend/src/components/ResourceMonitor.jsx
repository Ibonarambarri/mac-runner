import { useState, useEffect, useRef } from 'react';
import { Cpu, HardDrive, MemoryStick, Gpu, Activity, Layers } from 'lucide-react';
import { getSystemStatus } from '../api';

/**
 * Sparkline component - renders a small line chart
 */
function Sparkline({ data, color = '#22c55e', height = 20, width = 60 }) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="bg-slate-800 rounded" />;
  }

  const max = Math.max(...data, 100);
  const min = 0;
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - ((data[data.length - 1] - min) / range) * height}
          r="2"
          fill={color}
        />
      )}
    </svg>
  );
}

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
 * Get color based on memory pressure
 */
function getPressureColor(pressure) {
  switch (pressure) {
    case 'critical':
      return 'text-red-400';
    case 'warning':
      return 'text-yellow-400';
    default:
      return 'text-terminal-green';
  }
}

/**
 * ResourceMonitor Component
 *
 * Compact header widget showing system resource usage with sparkline history.
 * Polls the backend every 3 seconds for updated stats.
 */
export function ResourceMonitor() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // History for sparklines (last 30 data points = ~90 seconds at 3s interval)
  const historyRef = useRef({
    cpu: [],
    memory: [],
    swap: []
  });

  const MAX_HISTORY = 30;

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await getSystemStatus();
        setStatus(data);
        setError(null);

        // Update history
        const history = historyRef.current;
        history.cpu = [...history.cpu.slice(-(MAX_HISTORY - 1)), data.cpu.percent];
        history.memory = [...history.memory.slice(-(MAX_HISTORY - 1)), data.memory.percent];
        if (data.swap) {
          history.swap = [...history.swap.slice(-(MAX_HISTORY - 1)), data.swap.percent];
        }
      } catch (e) {
        setError(e.message);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 3 seconds for smoother sparklines
    const interval = setInterval(fetchStatus, 3000);
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

  const history = historyRef.current;

  // Determine color based on usage
  const getCpuColor = (percent) => {
    if (percent > 80) return 'bg-red-500';
    if (percent > 60) return 'bg-yellow-500';
    return 'bg-terminal-green';
  };

  const getCpuHexColor = (percent) => {
    if (percent > 80) return '#ef4444';
    if (percent > 60) return '#eab308';
    return '#22c55e';
  };

  const getMemColor = (percent) => {
    if (percent > 85) return 'bg-red-500';
    if (percent > 70) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  const getMemHexColor = (percent) => {
    if (percent > 85) return '#ef4444';
    if (percent > 70) return '#eab308';
    return '#3b82f6';
  };

  return (
    <div className="relative">
      {/* Compact view (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-3 py-1.5 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
      >
        {/* CPU with sparkline */}
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-300 w-8 text-right">
            {Math.round(status.cpu.percent)}%
          </span>
          <Sparkline
            data={history.cpu}
            color={getCpuHexColor(status.cpu.percent)}
            width={40}
            height={16}
          />
        </div>

        {/* Memory with sparkline */}
        <div className="flex items-center gap-1.5">
          <MemoryStick className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-300 w-8 text-right">
            {Math.round(status.memory.percent)}%
          </span>
          <Sparkline
            data={history.memory}
            color={getMemHexColor(status.memory.percent)}
            width={40}
            height={16}
          />
        </div>

        {/* GPU indicator (if available) */}
        {status.gpu && (
          <div className="flex items-center gap-1.5">
            <Gpu className="w-3.5 h-3.5 text-purple-400" />
            {status.gpu.utilization !== null ? (
              <span className="text-xs text-slate-300 w-8 text-right">
                {Math.round(status.gpu.utilization)}%
              </span>
            ) : (
              <span className="text-xs text-purple-400">ON</span>
            )}
          </div>
        )}
      </button>

      {/* Expanded view (dropdown) */}
      {expanded && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 p-4 space-y-4">
          {/* CPU Details */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-terminal-green" />
                <span className="text-sm text-slate-300">CPU</span>
              </div>
              <span className="text-sm text-slate-400">{status.cpu.count} cores</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getCpuColor(status.cpu.percent)} transition-all duration-300`}
                    style={{ width: `${status.cpu.percent}%` }}
                  />
                </div>
              </div>
              <Sparkline
                data={history.cpu}
                color={getCpuHexColor(status.cpu.percent)}
                width={60}
                height={20}
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
                {status.memory.pressure && (
                  <span className={`text-xs ${getPressureColor(status.memory.pressure)}`}>
                    ({status.memory.pressure})
                  </span>
                )}
              </div>
              <span className="text-sm text-slate-400">
                {status.memory.used_gb}GB / {status.memory.total_gb}GB
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getMemColor(status.memory.percent)} transition-all duration-300`}
                    style={{ width: `${status.memory.percent}%` }}
                  />
                </div>
              </div>
              <Sparkline
                data={history.memory}
                color={getMemHexColor(status.memory.percent)}
                width={60}
                height={20}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {Math.round(status.memory.percent)}% used
              {status.memory.available_gb && (
                <span className="ml-2">({status.memory.available_gb}GB available)</span>
              )}
            </div>
          </div>

          {/* Swap Details (if used) */}
          {status.swap && status.swap.total_gb > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-orange-400" />
                  <span className="text-sm text-slate-300">Swap</span>
                </div>
                <span className="text-sm text-slate-400">
                  {status.swap.used_gb}GB / {status.swap.total_gb}GB
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 transition-all duration-300"
                      style={{ width: `${status.swap.percent}%` }}
                    />
                  </div>
                </div>
                <Sparkline
                  data={history.swap}
                  color="#f97316"
                  width={60}
                  height={20}
                />
              </div>
              <div className="text-xs text-slate-500 mt-1">{Math.round(status.swap.percent)}% used</div>
            </div>
          )}

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

          {/* Last updated */}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Activity className="w-3 h-3" />
              <span>Updates every 3s</span>
            </div>
          </div>
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
