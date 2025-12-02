import { useState, useEffect, useCallback } from 'react';
import { Terminal, Plus, RefreshCw, Cpu } from 'lucide-react';

import { ProjectCard } from './components/ProjectCard';
import { LogViewer } from './components/LogViewer';
import { NewProjectModal } from './components/NewProjectModal';
import { useLogStream } from './hooks/useLogStream';

import {
  getProjects,
  createProject,
  deleteProject,
  updateProject,
  runProject,
  installProject,
  stopJob,
  getProjectJobs,
} from './api';

/**
 * Main App Component
 *
 * Dashboard layout with:
 * - Left panel: Project list
 * - Right panel: Log viewer
 */
function App() {
  // State
  const [projects, setProjects] = useState([]);
  const [projectJobs, setProjectJobs] = useState({});
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  // Log streaming hook
  const { logs, isConnected, isComplete, error: wsError, clearLogs } = useLogStream(selectedJobId);

  // Fetch projects on mount and periodically
  const fetchProjects = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(data);

      // Fetch jobs for each project
      const jobsMap = {};
      for (const project of data) {
        try {
          const jobs = await getProjectJobs(project.id);
          jobsMap[project.id] = jobs;
        } catch (e) {
          console.error(`Failed to fetch jobs for project ${project.id}:`, e);
        }
      }
      setProjectJobs(jobsMap);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    fetchProjects();

    // Poll for updates every 3 seconds
    const interval = setInterval(fetchProjects, 3000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  // Handlers
  const handleCreateProject = async (data) => {
    setIsCreating(true);
    try {
      await createProject(data);
      setIsModalOpen(false);
      await fetchProjects();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      await deleteProject(projectId);
      await fetchProjects();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleUpdateProject = async (projectId, data) => {
    try {
      await updateProject(projectId, data);
      await fetchProjects();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRunProject = async (projectId) => {
    try {
      const job = await runProject(projectId);
      setSelectedJobId(job.id);
      await fetchProjects();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleInstallProject = async (projectId) => {
    try {
      const job = await installProject(projectId);
      setSelectedJobId(job.id);
      await fetchProjects();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleStopJob = async (jobId) => {
    try {
      await stopJob(jobId);
      await fetchProjects();
    } catch (e) {
      setError(e.message);
    }
  };

  // Get current running job for a project
  const getRunningJobId = (projectId) => {
    const jobs = projectJobs[projectId] || [];
    const runningJob = jobs.find((j) => j.status === 'running');
    return runningJob?.id;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-2 bg-terminal-green/20 rounded-lg">
                <Terminal className="w-5 h-5 sm:w-6 sm:h-6 text-terminal-green" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-100">MacRunner</h1>
                <p className="text-xs text-slate-500 hidden sm:block">Task Orchestration Dashboard</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={fetchProjects}
                className="p-2.5 sm:p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
                title="Refresh"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-2 bg-terminal-green text-slate-950 font-semibold rounded-lg hover:bg-terminal-green/90 transition-colors touch-manipulation"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New Project</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/30 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span className="text-red-400 text-sm">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 min-h-[calc(100dvh-140px)] sm:min-h-[calc(100dvh-180px)]">
          {/* Left panel: Projects */}
          <div className="flex flex-col min-h-[300px] lg:min-h-0">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-lg font-semibold text-slate-300">Projects</h2>
              <span className="text-xs sm:text-sm text-slate-500">
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="flex-1 overflow-auto space-y-3 sm:space-y-4 pr-1 sm:pr-2 -mr-1 sm:-mr-2">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                  <Cpu className="w-10 h-10 sm:w-12 sm:h-12 mb-4 opacity-50" />
                  <p>No projects yet</p>
                  <p className="text-sm mt-1">
                    Click "New Project" to get started
                  </p>
                </div>
              ) : (
                projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    jobs={projectJobs[project.id] || []}
                    onRun={handleRunProject}
                    onStop={handleStopJob}
                    onInstall={handleInstallProject}
                    onDelete={handleDeleteProject}
                    onUpdate={handleUpdateProject}
                    onSelectJob={setSelectedJobId}
                    isRunning={project.status === 'running'}
                    currentJobId={selectedJobId || getRunningJobId(project.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right panel: Log Viewer */}
          <div className="flex flex-col min-h-[250px] lg:min-h-0">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-lg font-semibold text-slate-300">
                {selectedJobId ? `Job #${selectedJobId}` : 'Output'}
              </h2>
              {selectedJobId && (
                <button
                  onClick={() => {
                    setSelectedJobId(null);
                    clearLogs();
                  }}
                  className="text-sm text-slate-500 hover:text-slate-300 px-2 py-1 touch-manipulation"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              <LogViewer
                logs={logs}
                isConnected={isConnected}
                isComplete={isComplete}
                error={wsError}
              />
            </div>
          </div>
        </div>
      </main>

      {/* New Project Modal */}
      <NewProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateProject}
        isLoading={isCreating}
      />
    </div>
  );
}

export default App;
