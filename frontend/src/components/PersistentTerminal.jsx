import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Terminal, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { startTerminalSession, getTerminalWebSocketUrl, getTerminalStatus } from '../api';
import { useTerminal } from '../contexts/TerminalContext';

/**
 * PersistentTerminal Component
 *
 * Full-screen terminal that persists in the background.
 * Unlike TerminalModal, this component:
 * - Never unmounts - uses CSS to hide/show
 * - Maintains WebSocket connection when hidden
 * - Preserves terminal state (scrollback, etc.)
 * - Calls fitAddon.fit() when becoming visible
 */
export function PersistentTerminal() {
  const {
    isTerminalOpen,
    sessionId,
    isConnected,
    setSessionId,
    setIsConnected,
    xtermRef,
    wsRef,
    fitAddonRef,
    containerRef,
    closeTerminal,
  } = useTerminal();

  const terminalDivRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isInitializedRef = useRef(false);

  // Initialize xterm.js terminal
  const initTerminal = useCallback(() => {
    if (xtermRef.current || !terminalDivRef.current) return;

    // Create xterm instance with MacRunner dark theme
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#020617', // slate-950
        foreground: '#e2e8f0', // slate-200
        cursor: '#00ff88', // terminal-green
        cursorAccent: '#020617',
        selectionBackground: '#00ff8833',
        selectionForeground: '#00ff88',
        black: '#1e293b',
        red: '#f87171',
        green: '#00ff88',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#4ade80',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 10000,
      scrollOnUserInput: true,
    });

    // Add fit addon for auto-resizing
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Add web links addon for clickable URLs
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal in container
    term.open(terminalDivRef.current);

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    xtermRef.current = term;
  }, [xtermRef, fitAddonRef]);

  // Connect to WebSocket
  const connectWebSocket = useCallback((sid) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = getTerminalWebSocketUrl(sid);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);

      // Send initial resize
      if (xtermRef.current && fitAddonRef.current) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: dims.cols,
            rows: dims.rows
          }));
        }
      }
    };

    ws.onmessage = (event) => {
      if (xtermRef.current) {
        if (event.data instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(event.data);
          xtermRef.current.write(text);
        } else {
          xtermRef.current.write(event.data);
        }
      }
    };

    ws.onerror = (e) => {
      console.error('Terminal WebSocket error:', e);
      setError('Connection error');
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, [wsRef, xtermRef, fitAddonRef, setIsConnected]);

  // Setup terminal input
  const setupTerminalInput = useCallback(() => {
    if (!xtermRef.current) return;

    const onDataDisposable = xtermRef.current.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(new TextEncoder().encode(data));
      }
    });

    return () => {
      onDataDisposable.dispose();
    };
  }, [xtermRef, wsRef]);

  // Handle resize
  const handleResize = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: dims.cols,
            rows: dims.rows
          }));
        }
      }
    }
  }, [fitAddonRef, xtermRef, wsRef]);

  // Reconnect to existing session
  const handleReconnect = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);

    try {
      // Check if session is still alive
      const status = await getTerminalStatus(sessionId);

      if (status.alive) {
        // Session is alive, just reconnect WebSocket
        connectWebSocket(sessionId);
      } else {
        // Session is dead, start a new one
        if (xtermRef.current) {
          xtermRef.current.write('\r\n\x1b[33m[Session expired, starting new session...]\x1b[0m\r\n');
        }
        const res = await startTerminalSession();
        setSessionId(res.session_id);
        connectWebSocket(res.session_id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, connectWebSocket, setSessionId, xtermRef]);

  // Start session when first opened (lazy initialization)
  useEffect(() => {
    if (isTerminalOpen && !sessionId && !isInitializedRef.current) {
      isInitializedRef.current = true;
      setLoading(true);
      setError(null);

      startTerminalSession()
        .then(res => {
          setSessionId(res.session_id);
        })
        .catch(e => {
          setError(e.message);
          setLoading(false);
          isInitializedRef.current = false;
        });
    }
  }, [isTerminalOpen, sessionId, setSessionId]);

  // Initialize terminal and connect when we have a session
  useEffect(() => {
    if (sessionId && !xtermRef.current) {
      const initTimeout = setTimeout(() => {
        initTerminal();
        connectWebSocket(sessionId);
        setLoading(false);
      }, 100);

      return () => clearTimeout(initTimeout);
    }
  }, [sessionId, initTerminal, connectWebSocket, xtermRef]);

  // Setup input handling after terminal is ready
  useEffect(() => {
    if (xtermRef.current && isConnected) {
      const cleanup = setupTerminalInput();
      return cleanup;
    }
  }, [isConnected, setupTerminalInput, xtermRef]);

  // Handle window resize
  useEffect(() => {
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      if (isTerminalOpen) {
        handleResize();
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [handleResize, isTerminalOpen, containerRef]);

  // CRUCIAL: Call fit when terminal becomes visible
  useEffect(() => {
    if (isTerminalOpen && fitAddonRef.current && xtermRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          fitAddonRef.current?.fit();
          xtermRef.current?.focus();
        }, 50);
      });
    }
  }, [isTerminalOpen, fitAddonRef, xtermRef]);

  // Handle escape key (Ctrl+Shift+Escape to close)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) {
        closeTerminal();
      }
    };

    if (isTerminalOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isTerminalOpen, closeTerminal]);

  // CSS-based hiding instead of unmounting
  const containerClass = isTerminalOpen
    ? 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm'
    : 'hidden';

  return (
    <div className={containerClass}>
      <div className="bg-slate-950 w-full h-full sm:h-[90vh] sm:max-w-5xl sm:rounded-xl border border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-terminal-green" />
            <span className="font-semibold text-slate-100">Terminal</span>
            {sessionId && (
              <span className="text-xs text-slate-500">Session #{sessionId}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Reconnect button when disconnected */}
            {!isConnected && sessionId && !loading && (
              <button
                onClick={handleReconnect}
                className="flex items-center gap-1.5 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reconnect
              </button>
            )}
            {/* Connection status */}
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-terminal-green" />
                  <span className="text-xs text-terminal-green hidden sm:inline">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-red-400 hidden sm:inline">Disconnected</span>
                </>
              )}
            </div>
            <button
              onClick={closeTerminal}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
              title="Close (Ctrl+Shift+Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Terminal container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative"
          style={{ minHeight: '300px' }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full bg-slate-950">
              <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full bg-slate-950">
              <div className="text-red-400">Error: {error}</div>
            </div>
          ) : (
            <div
              ref={terminalDivRef}
              className="w-full h-full"
              style={{
                padding: '8px',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>

        {/* Mobile input helper */}
        <div className="sm:hidden border-t border-slate-800 bg-slate-900/30 px-4 py-2 flex-shrink-0 pb-safe">
          <div className="text-xs text-slate-500 text-center">
            Tap terminal to type | Swipe to scroll
          </div>
        </div>
      </div>
    </div>
  );
}
