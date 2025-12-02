import { useState } from 'react';
import { Play, Plus, Trash2, Terminal, X, Settings, Check, Pencil } from 'lucide-react';
import { createCommandTemplate, deleteCommandTemplate, updateCommandTemplate } from '../api';

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
  const [newCommand, setNewCommand] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingCommands, setEditingCommands] = useState([]);

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

  const handleOpenSettings = () => {
    setEditingCommands(commands.map(cmd => ({ ...cmd, newCommand: cmd.command })));
    setIsSettingsOpen(true);
  };

  const handleUpdateCommand = (id, value) => {
    setEditingCommands(prev =>
      prev.map(cmd => cmd.id === id ? { ...cmd, newCommand: value } : cmd)
    );
  };

  const handleDeleteInSettings = (id) => {
    setEditingCommands(prev => prev.filter(cmd => cmd.id !== id));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setError(null);

    try {
      // Find commands to update
      const toUpdate = editingCommands.filter(cmd => {
        const original = commands.find(c => c.id === cmd.id);
        return original && original.command !== cmd.newCommand;
      });

      // Find commands to delete
      const toDelete = commands.filter(
        cmd => !editingCommands.find(c => c.id === cmd.id)
      );

      // Update commands
      for (const cmd of toUpdate) {
        const cmdParts = cmd.newCommand.trim().split(/\s+/);
        const autoName = cmdParts[0] || 'custom';
        await updateCommandTemplate(projectId, cmd.id, {
          name: autoName,
          command: cmd.newCommand.trim(),
        });
      }

      // Delete commands
      for (const cmd of toDelete) {
        await deleteCommandTemplate(projectId, cmd.id);
      }

      setIsSettingsOpen(false);
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
        <div className="flex items-center gap-2">
          {commands.length > 0 && (
            <button
              onClick={handleOpenSettings}
              disabled={disabled}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Edit commands"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
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
              className="flex items-center gap-3 p-2 bg-slate-800/30 rounded-lg group"
            >
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
                  onClick={() => handleDelete(cmd.id, cmd.command)}
                  disabled={disabled}
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete command"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-slate-400" />
                <span className="font-semibold text-slate-100">Edit Commands</span>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
              {editingCommands.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">No commands to edit</p>
              ) : (
                editingCommands.map((cmd) => (
                  <div key={cmd.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={cmd.newCommand}
                      onChange={(e) => handleUpdateCommand(cmd.id, e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-terminal-green"
                    />
                    <button
                      onClick={() => handleDeleteInSettings(cmd.id)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Remove command"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-4 py-3 border-t border-slate-800 bg-slate-900/30">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 text-sm bg-terminal-green text-slate-950 font-semibold rounded-lg hover:bg-terminal-green/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default CommandSection;
