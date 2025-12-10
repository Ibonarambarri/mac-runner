import { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * ScriptEditor Component
 *
 * Modal for creating and editing system scripts with syntax highlighting.
 */
export function ScriptEditor({
  isOpen,
  onClose,
  onSave,
  script = null,
  initialContent = '',
  isLoading = false
}) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [scriptType, setScriptType] = useState('bash');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const isEditing = script !== null;

  // Initialize form when opened
  useEffect(() => {
    if (isOpen) {
      if (script) {
        // Editing existing script
        setName(script.name.replace(/\.(sh|py)$/, ''));
        setScriptType(script.type);
        setContent(initialContent);
      } else {
        // Creating new script
        setName('');
        setContent(getDefaultContent('bash'));
        setScriptType('bash');
      }
      setError(null);
    }
  }, [isOpen, script, initialContent]);

  // Update content when initialContent changes (for editing)
  useEffect(() => {
    if (isEditing && initialContent) {
      setContent(initialContent);
    }
  }, [initialContent, isEditing]);

  // Get default content based on script type
  const getDefaultContent = (type) => {
    if (type === 'python') {
      return `#!/usr/bin/env python3
"""
Script description here
"""

def main():
    pass

if __name__ == "__main__":
    main()
`;
    }
    return `#!/bin/bash
# Script description here

`;
  };

  // Handle script type change
  const handleTypeChange = (newType) => {
    setScriptType(newType);
    if (!isEditing && !content.trim()) {
      setContent(getDefaultContent(newType));
    }
  };

  // Get CodeMirror language extension
  const getLanguageExtension = () => {
    if (scriptType === 'python') {
      return python();
    }
    // Use javascript for bash (closest available)
    return javascript();
  };

  // Handle save
  const handleSave = async () => {
    setError(null);

    // Validate
    if (!isEditing && !name.trim()) {
      setError('Script name is required');
      return;
    }

    if (!content.trim()) {
      setError('Script content cannot be empty');
      return;
    }

    // Validate name format
    if (!isEditing && !/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError('Name can only contain letters, numbers, underscores and hyphens');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        content,
        scriptType,
        isEditing
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save script');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-200">
            {isEditing ? `Edit Script: ${script.display_name}` : 'Create New Script'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Name and Type row (only for new scripts) */}
          {!isEditing && (
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Script Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my_script"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-terminal-green/50 focus:border-terminal-green"
                />
              </div>
              <div className="w-40">
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Type
                </label>
                <select
                  value={scriptType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-terminal-green/50 focus:border-terminal-green"
                >
                  <option value="bash">Bash (.sh)</option>
                  <option value="python">Python (.py)</option>
                </select>
              </div>
            </div>
          )}

          {/* Script type indicator for editing */}
          {isEditing && (
            <div className="text-sm text-slate-400">
              Type: <span className="text-slate-300">{scriptType === 'python' ? 'Python' : 'Bash'}</span>
            </div>
          )}

          {/* Code Editor */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Script Content
            </label>
            {isLoading ? (
              <div className="flex items-center justify-center h-64 bg-slate-800 rounded-lg border border-slate-600">
                <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
              </div>
            ) : (
              <CodeMirror
                value={content}
                height="400px"
                theme={oneDark}
                extensions={[getLanguageExtension()]}
                onChange={(value) => setContent(value)}
                className="rounded-lg overflow-hidden border border-slate-600"
              />
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>{isEditing ? 'Save Changes' : 'Create Script'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScriptEditor;
