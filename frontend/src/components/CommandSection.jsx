import { useState } from 'react';
import { Play, Plus, Trash2, Terminal, X, Check, Pencil, Zap } from 'lucide-react';
import { createCommandTemplate, deleteCommandTemplate, updateCommandTemplate, runOneOffCommand } from '../api';

/**
 * CommandSection Component
 *
 * Manages custom command templates for a project:
 * - List existing templates
 * - Create new templates
 * - Run templates
 * - Delete templates
 */
export function CommandSection({
  projectId,
  commands,
  onRunCommand,
  onCommandsChange,
  onJobStarted,
  disabled,
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newCommand, setNewCommand] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  // One-off command state
  const [quickCommand, setQuickCommand] = useState('');
  const [runningQuick, setRunningQuick] = useState(false);

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
      onCommandsChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunningQuick(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCommand.trim()) return;

    setSaving(true);
    setError(null);

    try {
      // Auto-generate name from command (first word or "custom")
      const cmdParts = newCommand.trim().split(/\s+/);
      const autoName = cmdParts[0] || 'custom';

      await createCommandTemplate(projectId, {
        name: autoName,
        command: newCommand.trim(),
        description: null,
      });
      setNewCommand('');
      setIsCreating(false);
      onCommandsChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (commandId, commandName) => {
    if (!confirm(`Delete command "${commandName}"?`)) return;

    try {
      await deleteCommandTemplate(projectId, commandId);
      onCommandsChange();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleStartEdit = (cmd) => {
    setEditingId(cmd.id);
    setEditValue(cmd.command);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleSaveEdit = async (cmdId) => {
    if (!editValue.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const cmdParts = editValue.trim().split(/\s+/);
      const autoName = cmdParts[0] || 'custom';
      await updateCommandTemplate(projectId, cmdId, {
        name: autoName,
        command: editValue.trim(),
      });
      setEditingId(null);
      setEditValue('');
      onCommandsChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Command Templates
        </h2>
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-terminal-green hover:text-terminal-green/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-2 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-xs">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:text-red-300">
            ×
          </button>
        </div>
      )}

      {/* Quick Run - One-off command */}
      <form onSubmit={handleRunQuick} className="mb-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="text-xs font-medium text-slate-400">Quick Run (one-off)</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={quickCommand}
            onChange={(e) => setQuickCommand(e.target.value)}
            placeholder="Run any command once..."
            disabled={disabled}
            className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-yellow-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || runningQuick || !quickCommand.trim()}
            className="px-3 py-2 bg-yellow-500/20 text-yellow-400 text-sm rounded hover:bg-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
        </div>
      </form>

      {/* Create form */}
      {isCreating && (
        <form onSubmit={handleCreate} className="mb-4 p-3 bg-slate-800/50 rounded-lg">
          <div className="flex gap-2">
            <input
              type="text"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              placeholder="e.g., pytest, npm run build"
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
              autoFocus
            />
            <button
              type="submit"
              disabled={saving || !newCommand.trim()}
              className="px-3 py-2 bg-terminal-green/20 text-terminal-green text-sm rounded hover:bg-terminal-green/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewCommand('');
                setError(null);
              }}
              className="px-3 py-2 bg-slate-700 text-slate-300 text-sm rounded hover:bg-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* Command list */}
      {commands.length === 0 && !isCreating ? (
        <p className="text-slate-500 text-sm">
          No custom commands yet. Add one to run custom scripts.
        </p>
      ) : (
        <div className="space-y-2">
          {commands.map((cmd) => (
            <div
              key={cmd.id}
              className="flex items-center gap-2 p-2 bg-slate-800/30 rounded-lg group"
            >
              {editingId === cmd.id ? (
                /* Editing mode */
                <>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-sm font-mono text-slate-200 focus:outline-none focus:border-terminal-green"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveEdit(cmd.id)}
                    disabled={saving || !editValue.trim()}
                    className="p-1.5 text-terminal-green hover:bg-terminal-green/20 rounded transition-colors disabled:opacity-50"
                    title="Save"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1.5 text-slate-400 hover:bg-slate-700 rounded transition-colors"
                    title="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                /* Display mode */
                <>
                  <code className="flex-1 text-sm text-slate-300 font-mono truncate">{cmd.command}</code>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onRunCommand(cmd.id)}
                      disabled={disabled}
                      className="p-1.5 text-terminal-green hover:bg-terminal-green/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Run command"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleStartEdit(cmd)}
                      disabled={disabled}
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Edit command"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(cmd.id, cmd.command)}
                      disabled={disabled}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Delete command"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

    </section>
  );
}

export default CommandSection;
