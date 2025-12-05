import { useState, useEffect } from 'react';
import { Terminal, Play, Loader2, CheckCircle, XCircle, ChevronDown, ChevronUp, FileCode } from 'lucide-react';
import { getSystemScripts, runSystemScript } from '../api';

/**
 * SystemScripts Component
 *
 * Displays and executes system-level maintenance scripts.
 * Scripts are located in backend/system_scripts folder.
 */
export function SystemScripts() {
  const [scripts, setScripts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runningScript, setRunningScript] = useState(null);
  const [results, setResults] = useState({}); // script_name -> result
  const [expandedResults, setExpandedResults] = useState({}); // script_name -> boolean

  // Fetch available scripts
  useEffect(() => {
    const fetchScripts = async () => {
      try {
        const data = await getSystemScripts();
        setScripts(data.scripts || []);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchScripts();
  }, []);

  // Execute a script
  const handleRunScript = async (scriptName) => {
    setRunningScript(scriptName);
    // Clear previous result for this script
    setResults(prev => ({ ...prev, [scriptName]: null }));

    try {
      const result = await runSystemScript(scriptName);
      setResults(prev => ({ ...prev, [scriptName]: result }));
      // Auto-expand result
      setExpandedResults(prev => ({ ...prev, [scriptName]: true }));
    } catch (e) {
      setResults(prev => ({
        ...prev,
        [scriptName]: {
          success: false,
          exit_code: -1,
          output: `Error: ${e.message}`
        }
      }));
      setExpandedResults(prev => ({ ...prev, [scriptName]: true }));
    } finally {
      setRunningScript(null);
    }
  };

  // Toggle result expansion
  const toggleResult = (scriptName) => {
    setExpandedResults(prev => ({
      ...prev,
      [scriptName]: !prev[scriptName]
    }));
  };

  // Get icon for script type
  const getScriptIcon = (type) => {
    if (type === 'python') {
      return <FileCode className="w-4 h-4 text-blue-400" />;
    }
    return <Terminal className="w-4 h-4 text-green-400" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
        <p>Error loading scripts: {error}</p>
      </div>
    );
  }

  if (scripts.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <Terminal className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p>No system scripts available</p>
        <p className="text-xs mt-1">Add .sh or .py files to backend/system_scripts/</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scripts.map(script => {
        const isRunning = runningScript === script.name;
        const result = results[script.name];
        const isExpanded = expandedResults[script.name];

        return (
          <div
            key={script.name}
            className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
          >
            {/* Script info row */}
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {getScriptIcon(script.type)}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-200 truncate">
                    {script.display_name}
                  </h4>
                  <p className="text-xs text-slate-500 truncate">
                    {script.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-3">
                {/* Result indicator */}
                {result && !isRunning && (
                  <button
                    onClick={() => toggleResult(script.name)}
                    className={`p-1.5 rounded transition-colors ${
                      result.success
                        ? 'text-green-400 hover:bg-green-500/20'
                        : 'text-red-400 hover:bg-red-500/20'
                    }`}
                  >
                    {result.success ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                  </button>
                )}

                {/* Run button */}
                <button
                  onClick={() => handleRunScript(script.name)}
                  disabled={isRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Run</span>
                    </>
                  )}
                </button>

                {/* Expand/collapse toggle */}
                {result && (
                  <button
                    onClick={() => toggleResult(script.name)}
                    className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Result output */}
            {result && isExpanded && (
              <div className="border-t border-slate-700">
                <div className="p-3 bg-slate-900/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">
                      Exit code: {result.exit_code}
                    </span>
                    <span className={`text-xs ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                      {result.success ? 'Success' : 'Failed'}
                    </span>
                  </div>
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto bg-slate-950 rounded p-2">
                    {result.output || '(no output)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default SystemScripts;
