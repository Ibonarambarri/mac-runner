/**
 * MacRunner API Client
 * REST API functions for communicating with the FastAPI backend.
 */

// Dynamically determine API base URL based on current host
// This allows the app to work both locally and via Tailscale/remote access
const getApiBase = () => {
  const { protocol, hostname } = window.location;
  // In production or when accessing remotely, use port 8000 on the same host
  return `${protocol}//${hostname}:8000`;
};

const API_BASE = getApiBase();

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// PROJECT API
// ============================================================================

/**
 * Create a new project from a GitHub URL
 */
export async function createProject(data) {
  return apiFetch('/projects/', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Get all projects
 */
export async function getProjects() {
  return apiFetch('/projects/');
}

/**
 * Get a single project by ID
 */
export async function getProject(projectId) {
  return apiFetch(`/projects/${projectId}`);
}

/**
 * Update project configuration
 */
export async function updateProject(projectId, data) {
  return apiFetch(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a project
 */
export async function deleteProject(projectId) {
  return apiFetch(`/projects/${projectId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// JOB API
// ============================================================================

/**
 * Run the install command for a project
 */
export async function installProject(projectId) {
  return apiFetch(`/projects/${projectId}/install`, {
    method: 'POST',
  });
}

/**
 * Run the main command for a project
 */
export async function runProject(projectId) {
  return apiFetch(`/projects/${projectId}/run`, {
    method: 'POST',
  });
}

/**
 * Execute git pull for a project
 */
export async function pullProject(projectId) {
  return apiFetch(`/projects/${projectId}/pull`, {
    method: 'POST',
  });
}

/**
 * Get all jobs for a project
 */
export async function getProjectJobs(projectId) {
  return apiFetch(`/projects/${projectId}/jobs`);
}

/**
 * Get a single job by ID
 */
export async function getJob(jobId) {
  return apiFetch(`/jobs/${jobId}`);
}

/**
 * Stop a running job
 */
export async function stopJob(jobId) {
  return apiFetch(`/jobs/${jobId}/stop`, {
    method: 'POST',
  });
}

/**
 * Delete a job from history
 */
export async function deleteJob(jobId) {
  return apiFetch(`/jobs/${jobId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// COMMAND TEMPLATES API
// ============================================================================

/**
 * Get all command templates for a project
 */
export async function getCommandTemplates(projectId) {
  return apiFetch(`/projects/${projectId}/commands`);
}

/**
 * Create a new command template
 */
export async function createCommandTemplate(projectId, data) {
  return apiFetch(`/projects/${projectId}/commands`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update a command template
 */
export async function updateCommandTemplate(projectId, commandId, data) {
  return apiFetch(`/projects/${projectId}/commands/${commandId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a command template
 */
export async function deleteCommandTemplate(projectId, commandId) {
  return apiFetch(`/projects/${projectId}/commands/${commandId}`, {
    method: 'DELETE',
  });
}

/**
 * Run a command template
 */
export async function runCommandTemplate(projectId, commandId) {
  return apiFetch(`/projects/${projectId}/commands/${commandId}/run`, {
    method: 'POST',
  });
}

/**
 * Run a one-off command (without saving as template)
 */
export async function runOneOffCommand(projectId, command) {
  return apiFetch(`/projects/${projectId}/run-command`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

// ============================================================================
// FILE EXPLORER API
// ============================================================================

/**
 * List files and directories at a path
 */
export async function listFiles(projectId, path = '') {
  return apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`);
}

/**
 * Get file content
 */
export async function getFileContent(projectId, path) {
  const url = `${API_BASE}/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Get file download URL
 */
export function getFileDownloadUrl(projectId, path) {
  return `${API_BASE}/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`;
}

/**
 * Get folder ZIP download URL
 */
export function getFolderZipUrl(projectId, path = '') {
  return `${API_BASE}/projects/${projectId}/files/download-zip?path=${encodeURIComponent(path)}`;
}

/**
 * Get batch download URL for multiple selected files/folders
 */
export function getBatchDownloadUrl(projectId, paths) {
  const params = new URLSearchParams();
  paths.forEach(path => params.append('paths', path));
  return `${API_BASE}/projects/${projectId}/files/download-batch?${params.toString()}`;
}

// ============================================================================
// JUPYTER NOTEBOOK API
// ============================================================================

/**
 * Render a Jupyter notebook as HTML
 */
export async function renderNotebook(projectId, path) {
  return apiFetch(`/projects/${projectId}/notebook/render?path=${encodeURIComponent(path)}`);
}

/**
 * List all notebooks in a project
 */
export async function listNotebooks(projectId) {
  return apiFetch(`/projects/${projectId}/notebooks`);
}

/**
 * Run a notebook using Papermill
 */
export async function runNotebook(projectId, notebookPath, parameters = {}) {
  return apiFetch(`/projects/${projectId}/notebook/run`, {
    method: 'POST',
    body: JSON.stringify({ notebook_path: notebookPath, parameters }),
  });
}

/**
 * Start Jupyter Lab for a project
 */
export async function startJupyter(projectId) {
  return apiFetch(`/projects/${projectId}/jupyter/start`, {
    method: 'POST',
  });
}

/**
 * Stop Jupyter Lab for a project
 */
export async function stopJupyter(projectId) {
  return apiFetch(`/projects/${projectId}/jupyter/stop`, {
    method: 'POST',
  });
}

/**
 * Get Jupyter Lab status for a project
 */
export async function getJupyterStatus(projectId) {
  return apiFetch(`/projects/${projectId}/jupyter/status`);
}

// ============================================================================
// TERMINAL API
// ============================================================================

/**
 * Start a new terminal session
 */
export async function startTerminalSession() {
  return apiFetch('/terminal/start', {
    method: 'POST',
  });
}

/**
 * Get WebSocket URL for terminal
 */
export function getTerminalWebSocketUrl(sessionId) {
  const { hostname } = window.location;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:8000/ws/terminal/${sessionId}`;
}

// ============================================================================
// ENVIRONMENT VARIABLES API
// ============================================================================

/**
 * Get environment variables for a project
 */
export async function getProjectEnv(projectId) {
  return apiFetch(`/projects/${projectId}/env`);
}

/**
 * Save environment variables for a project
 */
export async function saveProjectEnv(projectId, variables) {
  return apiFetch(`/projects/${projectId}/env`, {
    method: 'PUT',
    body: JSON.stringify({ variables }),
  });
}

// ============================================================================
// TENSORBOARD API
// ============================================================================

/**
 * Detect TensorBoard log directories in a project
 */
export async function detectTensorboardDirs(projectId) {
  return apiFetch(`/projects/${projectId}/tensorboard/detect`);
}

/**
 * Start TensorBoard server for a project
 */
export async function startTensorboard(projectId, logDir = 'runs', port = 6006) {
  return apiFetch(`/projects/${projectId}/tensorboard/start?log_dir=${encodeURIComponent(logDir)}&port=${port}`, {
    method: 'POST',
  });
}

/**
 * Stop TensorBoard server
 */
export async function stopTensorboard(projectId, logDir = 'runs') {
  return apiFetch(`/projects/${projectId}/tensorboard/stop?log_dir=${encodeURIComponent(logDir)}`, {
    method: 'POST',
  });
}

/**
 * Get TensorBoard status for a project
 */
export async function getTensorboardStatus(projectId) {
  return apiFetch(`/projects/${projectId}/tensorboard/status`);
}

// ============================================================================
// SYSTEM STATUS API
// ============================================================================

/**
 * Get system resource status (CPU, memory, GPU)
 */
export async function getSystemStatus() {
  return apiFetch('/system/status');
}

// ============================================================================
// WEBSOCKET
// ============================================================================

/**
 * Get WebSocket URL for log streaming
 */
export function getLogWebSocketUrl(jobId) {
  const { hostname } = window.location;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:8000/ws/logs/${jobId}`;
}

/**
 * Get WebSocket URL for global status updates
 */
export function getStatusWebSocketUrl() {
  const { hostname } = window.location;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:8000/ws/status`;
}
