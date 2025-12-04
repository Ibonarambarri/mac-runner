import { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  File,
  FileText,
  FileCode,
  Image,
  ChevronRight,
  Download,
  Archive,
  ArrowLeft,
  Loader2,
  Home,
  CheckSquare,
  Square,
} from 'lucide-react';
import { listFiles, getFileDownloadUrl, getFolderZipUrl, getBatchDownloadUrl } from '../api';

/**
 * Get icon component based on file extension
 */
function getFileIcon(extension, isDirectory) {
  if (isDirectory) return Folder;

  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'rb', 'php', 'ipynb'];
  const textExtensions = ['txt', 'md', 'json', 'yml', 'yaml', 'xml', 'html', 'css', 'scss'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'];

  if (codeExtensions.includes(extension)) return FileCode;
  if (textExtensions.includes(extension)) return FileText;
  if (imageExtensions.includes(extension)) return Image;

  return File;
}

/**
 * Format file size in human readable format
 */
function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * FileExplorer Component
 *
 * Tree-style file browser with navigation and download.
 */
export function FileExplorer({ projectId }) {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState(new Set());

  // Fetch files for current path
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFiles(projectId, currentPath);
      setFiles(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, currentPath]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Navigate to a directory
  const navigateTo = (path) => {
    setCurrentPath(path);
  };

  // Toggle select mode
  const toggleSelectMode = () => {
    if (selectMode) {
      setSelectedPaths(new Set());
    }
    setSelectMode(!selectMode);
  };

  // Toggle selection of a file/folder
  const toggleSelection = (path, e) => {
    e.stopPropagation();
    setSelectedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  // Handle batch download
  const handleBatchDownload = () => {
    if (selectedPaths.size === 0) return;
    const url = getBatchDownloadUrl(projectId, Array.from(selectedPaths));
    window.location.href = url;
  };

  // Go back one level
  const goBack = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigateTo(parts.join('/'));
  };

  // Handle file/folder click
  const handleFileClick = (file) => {
    if (file.is_directory) {
      navigateTo(file.path);
    }
    // For files, do nothing - user can download via button
  };

  // Build breadcrumb parts
  const breadcrumbParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden h-full">
      {/* Header with breadcrumb */}
      <div className="border-b border-slate-800 p-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => navigateTo('')}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0 touch-manipulation"
            title="Root"
          >
            <Home className="w-4 h-4" />
          </button>

          {breadcrumbParts.length > 0 && (
            <>
              <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
              {breadcrumbParts.map((part, index) => {
                const path = breadcrumbParts.slice(0, index + 1).join('/');
                const isLast = index === breadcrumbParts.length - 1;
                return (
                  <div key={path} className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => !isLast && navigateTo(path)}
                      className={`text-sm ${
                        isLast
                          ? 'text-slate-200 cursor-default'
                          : 'text-slate-400 hover:text-slate-200'
                      } touch-manipulation`}
                    >
                      {part}
                    </button>
                    {!isLast && <ChevronRight className="w-4 h-4 text-slate-600" />}
                  </div>
                );
              })}
            </>
          )}

          {/* Select mode and download buttons */}
          <div className="ml-auto flex items-center gap-2">
            {selectMode && selectedPaths.size > 0 && (
              <button
                onClick={handleBatchDownload}
                className="flex items-center gap-1.5 px-2 py-1 text-xs bg-terminal-green/20 text-terminal-green rounded hover:bg-terminal-green/30 transition-colors touch-manipulation"
              >
                <Download className="w-3.5 h-3.5" />
                Download {selectedPaths.size} selected
              </button>
            )}
            <button
              onClick={toggleSelectMode}
              className={`p-1.5 rounded transition-colors flex-shrink-0 touch-manipulation ${
                selectMode
                  ? 'bg-terminal-green/20 text-terminal-green'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title={selectMode ? 'Exit select mode' : 'Select files'}
            >
              <CheckSquare className="w-4 h-4" />
            </button>
            <a
              href={getFolderZipUrl(projectId, currentPath)}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0 touch-manipulation"
              title="Download folder as ZIP"
            >
              <Archive className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* File list */}
      <div className="overflow-y-auto no-bounce" style={{ maxHeight: 'calc(100vh - 400px)', minHeight: '300px' }}>
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
          </div>
        ) : error ? (
          <div className="p-4 text-red-400 text-sm">{error}</div>
        ) : files.length === 0 ? (
          <div className="p-4 text-slate-500 text-sm">Empty directory</div>
        ) : (
          <>
            {/* Back button if not at root */}
            {currentPath && (
              <button
                onClick={goBack}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 transition-colors text-left touch-manipulation"
              >
                <ArrowLeft className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-400">..</span>
              </button>
            )}

            {files.map((file) => {
              const FileIcon = getFileIcon(file.extension, file.is_directory);
              const isChecked = selectedPaths.has(file.path);

              return (
                <div
                  key={file.path}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 transition-colors group ${
                    isChecked ? 'bg-slate-800' : ''
                  }`}
                >
                  {/* Selection checkbox in select mode */}
                  {selectMode && (
                    <button
                      onClick={(e) => toggleSelection(file.path, e)}
                      className="flex-shrink-0 p-0.5 cursor-pointer"
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-terminal-green" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                      )}
                    </button>
                  )}
                  {/* File/folder content */}
                  <div
                    className={`flex items-center gap-3 flex-1 min-w-0 ${file.is_directory ? 'cursor-pointer' : ''}`}
                    onClick={() => handleFileClick(file)}
                  >
                    <FileIcon className={`w-4 h-4 flex-shrink-0 ${
                      file.is_directory ? 'text-yellow-400' : file.extension === 'ipynb' ? 'text-orange-400' : 'text-slate-400'
                    }`} />
                    <span className="text-sm flex-1 truncate text-slate-300">
                      {file.name}
                    </span>
                  </div>
                  {!file.is_directory && (
                    <>
                      <span className="text-xs text-slate-500">
                        {formatSize(file.size)}
                      </span>
                      {!selectMode && (
                        <a
                          href={getFileDownloadUrl(projectId, file.path)}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 text-slate-500 hover:text-slate-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity touch-manipulation"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </>
                  )}
                  {file.is_directory && !selectMode && (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
