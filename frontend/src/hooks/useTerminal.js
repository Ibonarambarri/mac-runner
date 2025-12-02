import { useState, useEffect, useRef, useCallback } from 'react';
import { getTerminalWebSocketUrl } from '../api';

/**
 * Custom hook for interactive terminal WebSocket.
 *
 * Features:
 * - Send commands
 * - Receive output
 * - Command history
 * - Auto-reconnect
 */
export function useTerminal(sessionId) {
  const [output, setOutput] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!sessionId) return;

    const wsUrl = getTerminalWebSocketUrl(sessionId);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'output') {
          setOutput(prev => [...prev, { type: 'output', content: msg.data }]);
        } else if (msg.type === 'error') {
          setOutput(prev => [...prev, { type: 'error', content: msg.data }]);
        }
        // Note: 'exit' type is intentionally not processed (no exit code display)
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('Terminal WebSocket error:', error);
    };

    ws.onclose = () => {
      setIsConnected(false);

      // Attempt to reconnect with exponential backoff
      const maxAttempts = 5;
      if (reconnectAttemptsRef.current < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
        reconnectAttemptsRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    wsRef.current = ws;
  }, [sessionId]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Connect when sessionId changes
  useEffect(() => {
    if (sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  // Send command to terminal
  const sendCommand = useCallback((command) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && command.trim()) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        data: command
      }));
      setCommandHistory(prev => [...prev, command]);
    }
  }, []);

  // Clear output
  const clearOutput = useCallback(() => {
    setOutput([]);
  }, []);

  return {
    output,
    isConnected,
    sendCommand,
    commandHistory,
    clearOutput,
    disconnect
  };
}
