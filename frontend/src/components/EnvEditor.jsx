import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Save, Loader2, Eye, EyeOff } from 'lucide-react';
import { getProjectEnv, saveProjectEnv } from '../api';

/**
 * EnvEditor Component
 *
 * Editor for project environment variables (.env file).
 * Supports adding, editing, and removing key-value pairs.
 */
export function EnvEditor({ projectId }) {
  const [variables, setVariables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [visibleValues, setVisibleValues] = useState({});

  // Fetch existing env vars
  const fetchEnv = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProjectEnv(projectId);
      setVariables(data.variables || []);
      setError(null);
      setHasChanges(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  // Handle save
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProjectEnv(projectId, variables);
      setHasChanges(false);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Add new variable
  const handleAdd = () => {
    setVariables([...variables, { key: '', value: '' }]);
    setHasChanges(true);
  };

  // Update a variable
  const handleUpdate = (index, field, value) => {
    const newVars = [...variables];
    newVars[index] = { ...newVars[index], [field]: value };
    setVariables(newVars);
    setHasChanges(true);
  };

  // Remove a variable
  const handleRemove = (index) => {
    setVariables(variables.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  // Toggle value visibility
  const toggleVisibility = (index) => {
    setVisibleValues({
      ...visibleValues,
      [index]: !visibleValues[index]
    });
  };

  // Check if a key looks like a secret
  const isLikelySecret = (key) => {
    const secretPatterns = ['key', 'secret', 'password', 'token', 'api', 'auth', 'credential'];
    return secretPatterns.some(pattern => key.toLowerCase().includes(pattern));
  };

  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/30">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-medium text-slate-300">Environment Variables</span>
          <span className="text-xs text-slate-500">(.env)</span>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-xs text-yellow-400">Unsaved changes</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green/20 text-terminal-green rounded-lg text-sm hover:bg-terminal-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Variables list */}
      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {variables.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No environment variables defined</p>
            <p className="text-xs mt-1">Click "Add Variable" to create one</p>
          </div>
        ) : (
          variables.map((variable, index) => {
            const showValue = visibleValues[index] || !isLikelySecret(variable.key);
            return (
              <div key={index} className="flex items-center gap-2">
                {/* Key input */}
                <input
                  type="text"
                  value={variable.key}
                  onChange={(e) => handleUpdate(index, 'key', e.target.value)}
                  placeholder="KEY"
                  className="w-1/3 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
                />

                <span className="text-slate-500">=</span>

                {/* Value input with visibility toggle */}
                <div className="flex-1 relative">
                  <input
                    type={showValue ? 'text' : 'password'}
                    value={variable.value}
                    onChange={(e) => handleUpdate(index, 'value', e.target.value)}
                    placeholder="value"
                    className="w-full px-3 py-2 pr-10 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
                  />
                  {isLikelySecret(variable.key) && (
                    <button
                      type="button"
                      onClick={() => toggleVisibility(index)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
                    >
                      {showValue ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>

                {/* Delete button */}
                <button
                  onClick={() => handleRemove(index)}
                  className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer with Add button */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/30">
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Variable
        </button>
      </div>
    </div>
  );
}

export default EnvEditor;
