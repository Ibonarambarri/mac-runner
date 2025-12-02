import { useState, useEffect, useCallback, useRef } from 'react';
import { getLogWebSocketUrl } from '../api';

/**
 * Custom hook for streaming logs via WebSocket.
 *
 * Features:
 * - Auto-reconnection on connection loss
 * - Maintains log history
 * - Connection status tracking
 *
 * @param {number|null} jobId - The job ID to stream logs for
 * @returns {Object} - { logs, isConnected, isComplete, error, clearLogs }
 */
export function useLogStream(jobId) {
  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const isCompleteRef = useRef(false);
  const maxReconnectAttempts = 5;

  const clearLogs = useCallback(() => {
    setLogs([]);
    setIsComplete(false);
    isCompleteRef.current = false;
    setError(null);
  }, []);

  const connect = useCallback(() => {
    if (!jobId) return;

    // Don't reconnect if already complete
    if (isCompleteRef.current) {
      return;
    }

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const url = getLogWebSocketUrl(jobId);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[WS] Connected to job ${jobId}`);
      setIsConnected(true);
      setError(null);
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'log':
            setLogs((prev) => [...prev, message.data]);
            break;

          case 'end':
            isCompleteRef.current = true;
            setIsComplete(true);
            console.log(`[WS] Job ${jobId} completed: ${message.message}`);
            break;

          case 'error':
            setError(message.message);
            console.error(`[WS] Error: ${message.message}`);
            break;

          default:
            console.warn(`[WS] Unknown message type: ${message.type}`);
        }
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    ws.onerror = (event) => {
      console.error('[WS] WebSocket error:', event);
      setError('Connection error');
    };

    ws.onclose = (event) => {
      console.log(`[WS] Connection closed (code: ${event.code})`);
      setIsConnected(false);

      // Don't reconnect if job is complete or closed normally
      if (isCompleteRef.current || event.code === 1000) {
        return;
      }

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttempts.current++;
          connect();
        }, delay);
      } else {
        setError('Max reconnection attempts reached');
      }
    };

    wsRef.current = ws;
  }, [jobId]);

  // Connect when jobId changes
  useEffect(() => {
    if (jobId) {
      clearLogs();
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [jobId, connect, clearLogs]);

  return {
    logs,
    isConnected,
    isComplete,
    error,
    clearLogs,
  };
}

export default useLogStream;
