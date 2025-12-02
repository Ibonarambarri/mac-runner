import { useState } from 'react';
import { X, GitBranch, Loader2 } from 'lucide-react';

/**
 * NewProjectModal Component
 *
 * Modal for creating a new project from a GitHub URL.
 */
export function NewProjectModal({ isOpen, onClose, onSubmit, isLoading }) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [installCommand, setInstallCommand] = useState('pip install -r requirements.txt');
  const [runCommand, setRunCommand] = useState('python main.py');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name || repoUrl.split('/').pop()?.replace('.git', '') || 'New Project',
      repo_url: repoUrl,
      install_command: installCommand,
      run_command: runCommand,
    });
  };

  // Auto-fill name from repo URL
  const handleRepoUrlChange = (url) => {
    setRepoUrl(url);
    if (!name) {
      const match = url.match(/\/([^\/]+?)(\.git)?$/);
      if (match) {
        setName(match[1]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-t-xl sm:rounded-xl w-full max-w-lg sm:mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-terminal-green/20 rounded-lg">
              <GitBranch className="w-5 h-5 text-terminal-green" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">New Project</h2>
          </div>
          <button
            onClick={onClose}
            className="p-3 -mr-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* Repo URL */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              GitHub Repository URL *
            </label>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => handleRepoUrlChange(e.target.value)}
              placeholder="https://github.com/user/repo"
              required
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green transition-colors"
            />
          </div>

          {/* Project Name */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Project"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green transition-colors"
            />
          </div>

          {/* Install Command */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Install Command
            </label>
            <input
              type="text"
              value={installCommand}
              onChange={(e) => setInstallCommand(e.target.value)}
              placeholder="pip install -r requirements.txt"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-terminal-green transition-colors"
            />
            <p className="mt-1 text-xs text-slate-500">
              Command to install dependencies (runs in project venv)
            </p>
          </div>

          {/* Run Command */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Run Command
            </label>
            <input
              type="text"
              value={runCommand}
              onChange={(e) => setRunCommand(e.target.value)}
              placeholder="python main.py"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-terminal-green transition-colors"
            />
            <p className="mt-1 text-xs text-slate-500">
              Command to start your task (training, rendering, etc.)
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 pb-safe">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3.5 sm:py-3 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !repoUrl}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 sm:py-3 bg-terminal-green text-slate-950 font-semibold rounded-lg hover:bg-terminal-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewProjectModal;
