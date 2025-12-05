import { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, Play, Pause, Calendar, ChevronDown, X, Loader2 } from 'lucide-react';
import {
  getScheduledTasks,
  getCronPresets,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
  getCommandTemplates
} from '../api';

/**
 * Format a cron expression to human-readable text
 */
function formatCron(cron) {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, day, month, dow] = parts;

  // Simple patterns
  if (minute === '0' && hour === '*' && day === '*' && month === '*' && dow === '*') {
    return 'Every hour';
  }
  if (minute === '*/30' && hour === '*' && day === '*' && month === '*' && dow === '*') {
    return 'Every 30 minutes';
  }
  if (minute === '0' && hour === '*/6' && day === '*' && month === '*' && dow === '*') {
    return 'Every 6 hours';
  }
  if (minute === '0' && hour === '0' && day === '*' && month === '*' && dow === '*') {
    return 'Daily at midnight';
  }
  if (minute === '0' && hour === '9' && day === '*' && month === '*' && dow === '*') {
    return 'Daily at 9:00 AM';
  }
  if (minute === '0' && hour === '9' && day === '*' && month === '*' && dow === '1') {
    return 'Weekly on Monday';
  }

  return cron;
}

/**
 * Format datetime to relative time
 */
function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Never';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date - now;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return `${absMins}m ago`;
    const hours = Math.floor(absMins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } else {
    if (diffMins < 60) return `in ${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) return `in ${hours}h`;
    return `in ${Math.floor(hours / 24)}d`;
  }
}

/**
 * ScheduleManager Component
 *
 * Manages scheduled/recurring tasks for a project.
 */
export function ScheduleManager({ projectId }) {
  const [tasks, setTasks] = useState([]);
  const [presets, setPresets] = useState({});
  const [commandTemplates, setCommandTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  // New task form state
  const [newTask, setNewTask] = useState({
    name: '',
    command: '',
    cron_expression: '0 9 * * *',
    description: ''
  });

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [tasksData, presetsData, templatesData] = await Promise.all([
          getScheduledTasks(projectId),
          getCronPresets(),
          getCommandTemplates(projectId)
        ]);
        setTasks(tasksData);
        setPresets(presetsData);
        setCommandTemplates(templatesData);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Handlers
  const handleCreate = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const created = await createScheduledTask({
        ...newTask,
        project_id: projectId
      });
      setTasks([...tasks, created]);
      setShowNewForm(false);
      setNewTask({ name: '', command: '', cron_expression: '0 9 * * *', description: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (task) => {
    try {
      const updated = await updateScheduledTask(task.id, { enabled: !task.enabled });
      setTasks(tasks.map(t => t.id === task.id ? updated : t));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (taskId) => {
    if (!confirm('Delete this scheduled task?')) return;
    try {
      await deleteScheduledTask(taskId);
      setTasks(tasks.filter(t => t.id !== taskId));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRunNow = async (task) => {
    try {
      await runScheduledTaskNow(task.id);
      // Refresh tasks to get updated last_run
      const updated = await getScheduledTasks(projectId);
      setTasks(updated);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSelectTemplate = (template) => {
    setNewTask({
      ...newTask,
      name: template.name,
      command: template.command,
      description: template.description || ''
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-terminal-green" />
          <h3 className="text-lg font-semibold text-slate-200">Scheduled Tasks</h3>
          <span className="text-xs text-slate-500">({tasks.length})</span>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Schedule
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* New Task Form */}
      {showNewForm && (
        <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-slate-300">New Scheduled Task</h4>
            <button onClick={() => setShowNewForm(false)} className="text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick select from templates */}
          {commandTemplates.length > 0 && (
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Quick Select from Templates</label>
              <div className="flex flex-wrap gap-2">
                {commandTemplates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs hover:bg-slate-600 transition-colors"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Name</label>
              <input
                type="text"
                value={newTask.name}
                onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                placeholder="Daily git pull"
                required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:border-terminal-green"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Command</label>
              <input
                type="text"
                value={newTask.command}
                onChange={(e) => setNewTask({ ...newTask, command: e.target.value })}
                placeholder="git pull origin main"
                required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 text-sm font-mono focus:outline-none focus:border-terminal-green"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Schedule</label>
              <div className="flex gap-2">
                <select
                  value=""
                  onChange={(e) => {
                    const preset = presets[e.target.value];
                    if (preset) {
                      setNewTask({ ...newTask, cron_expression: preset.cron });
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:border-terminal-green"
                >
                  <option value="">Select preset...</option>
                  {Object.entries(presets).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newTask.cron_expression}
                  onChange={(e) => setNewTask({ ...newTask, cron_expression: e.target.value })}
                  placeholder="0 9 * * *"
                  className="w-32 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 text-sm font-mono focus:outline-none focus:border-terminal-green"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Format: minute hour day month day_of_week (UTC)
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="px-3 py-1.5 text-slate-400 hover:text-slate-200 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green text-slate-950 rounded-lg hover:bg-terminal-green/90 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Task List */}
      {tasks.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No scheduled tasks</p>
          <p className="text-xs mt-1">Click "Schedule" to create recurring jobs</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div
              key={task.id}
              className={`p-3 bg-slate-800/50 border rounded-lg ${
                task.enabled ? 'border-slate-700' : 'border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${task.enabled ? 'bg-terminal-green' : 'bg-slate-600'}`} />
                    <span className="font-medium text-slate-200 truncate">{task.name}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 font-mono truncate">
                    {task.command}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="text-slate-400">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {formatCron(task.cron_expression)}
                    </span>
                    {task.next_run && (
                      <span className="text-terminal-green">
                        Next: {formatRelativeTime(task.next_run)}
                      </span>
                    )}
                    {task.last_run && (
                      <span className="text-slate-500">
                        Last: {formatRelativeTime(task.last_run)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleRunNow(task)}
                    className="p-1.5 text-slate-400 hover:text-terminal-green hover:bg-slate-700 rounded transition-colors"
                    title="Run now"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(task)}
                    className={`p-1.5 rounded transition-colors ${
                      task.enabled
                        ? 'text-terminal-green hover:text-yellow-400 hover:bg-slate-700'
                        : 'text-slate-500 hover:text-terminal-green hover:bg-slate-700'
                    }`}
                    title={task.enabled ? 'Pause' : 'Enable'}
                  >
                    {task.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ScheduleManager;
