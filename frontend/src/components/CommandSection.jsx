import { useState } from 'react';
import { Play, Plus, Trash2, Terminal, X } from 'lucide-react';
import { createCommandTemplate, deleteCommandTemplate } from '../api';

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
  disabled,
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newCommand.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await createCommandTemplate(projectId, {
        name: newName.trim(),
        command: newCommand.trim(),
        description: newDescription.trim() || null,
      });
      setNewName('');
      setNewCommand('');
      setNewDescription('');
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

      {/* Create form */}
      {isCreating && (
        <form onSubmit={handleCreate} className="mb-4 p-3 bg-slate-800/50 rounded-lg space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., test, build, deploy"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Command *</label>
            <input
              type="text"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              placeholder="e.g., pytest, npm run build"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description (optional)</label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What does this command do?"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !newName.trim() || !newCommand.trim()}
              className="flex-1 px-3 py-2 bg-terminal-green/20 text-terminal-green text-sm rounded hover:bg-terminal-green/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewName('');
                setNewCommand('');
                setNewDescription('');
                setError(null);
              }}
              className="px-3 py-2 bg-slate-700 text-slate-300 text-sm rounded hover:bg-slate-600"
            >
              Cancel
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
              className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">{cmd.name}</span>
                  {cmd.description && (
                    <span className="text-xs text-slate-500 truncate">
                      — {cmd.description}
                    </span>
                  )}
                </div>
                <code className="text-xs text-slate-400 font-mono">{cmd.command}</code>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onRunCommand(cmd.id)}
                  disabled={disabled}
                  className="p-2 text-terminal-green hover:bg-terminal-green/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Run command"
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(cmd.id, cmd.name)}
                  disabled={disabled}
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete command"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default CommandSection;
