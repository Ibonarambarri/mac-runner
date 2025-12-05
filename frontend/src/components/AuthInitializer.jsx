import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { setUnauthorizedCallback } from '../api';

/**
 * AuthInitializer Component
 *
 * Connects the auth context's handleUnauthorized callback to the API client.
 * This allows the API to trigger the login modal on 401 errors.
 */
export function AuthInitializer() {
  const { handleUnauthorized } = useAuth();

  useEffect(() => {
    // Set the callback in the API module
    setUnauthorizedCallback(handleUnauthorized);

    // Cleanup on unmount
    return () => {
      setUnauthorizedCallback(null);
    };
  }, [handleUnauthorized]);

  // This component doesn't render anything
  return null;
}
