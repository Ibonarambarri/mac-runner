import { GitBranch, Loader2, AlertCircle, Trash2, ChevronRight } from 'lucide-react';

/**
 * Status indicator colors and icons
 */
const STATUS_CONFIG = {
  idle: {
    color: 'bg-slate-500',
    icon: null,
    text: 'Idle',
  },
  cloning: {
    color: 'bg-blue-500',
    icon: Loader2,
    text: 'Cloning...',
    animate: true,
  },
  running: {
    color: 'bg-terminal-green',
    icon: null,
    text: 'Running',
    pulse: true,
  },
  error: {
    color: 'bg-red-500',
    icon: AlertCircle,
    text: 'Error',
  },
};

/**
 * ProjectCard Component (Simplified)
 *
 * Displays a project card for the home page grid.
 * Click anywhere on the card to navigate to the project detail page.
 */
export function ProjectCard({ project, onClick, onDelete }) {
  const status = STATUS_CONFIG[project.status] || STATUS_CONFIG.idle;
  const StatusIcon = status.icon;

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete(project.id);
  };

  return (
    <div
      onClick={onClick}
      className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden hover:border-slate-700 hover:bg-slate-900/70 transition-all cursor-pointer group"
    >
      <div className="p-4">
        {/* Header with name and status */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-slate-100 truncate group-hover:text-terminal-green transition-colors">
              {project.name}
            </h3>
            <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
              <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{project.repo_url}</span>
            </div>
          </div>

          {/* Delete button */}
          <button
            onClick={handleDelete}
            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Status and arrow */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${status.color} ${
                status.pulse ? 'status-pulse' : ''
              }`}
            />
            {StatusIcon && (
              <StatusIcon
                className={`w-4 h-4 text-slate-400 ${
                  status.animate ? 'animate-spin' : ''
                }`}
              />
            )}
            <span className="text-sm text-slate-400">{status.text}</span>
          </div>

          <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </div>
  );
}

export default ProjectCard;
