import { useState } from 'react';
import { Terminal, Lock, User, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * LoginModal Component
 *
 * Modal that appears when authentication is required.
 * Cannot be dismissed without logging in.
 */
export function LoginModal() {
  const { showLoginModal, login, loginError, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!showLoginModal) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;

    setIsSubmitting(true);
    await login(username, password);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-slate-800/50 px-6 py-5 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-terminal-green/20 rounded-lg">
                <Terminal className="w-6 h-6 text-terminal-green" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-100">MacRunner</h2>
                <p className="text-sm text-slate-400">Sign in to continue</p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Error Message */}
            {loginError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-sm text-red-400">{loginError}</span>
              </div>
            )}

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-2">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="w-5 h-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green transition-colors"
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-slate-500" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green transition-colors"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !username || !password}
              className="w-full py-3 bg-terminal-green text-slate-950 font-semibold rounded-lg hover:bg-terminal-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-800/30 border-t border-slate-700">
            <p className="text-xs text-slate-500 text-center">
              Default credentials: admin / admin
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
