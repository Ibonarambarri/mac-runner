import { useState } from 'react';
import { UserPlus, Lock, User, Shield, AlertCircle, Eye, EyeOff, X } from 'lucide-react';

/**
 * CreateUserModal Component
 *
 * Modal for administrators to create new users.
 * Similar style to LoginModal.
 */
export function CreateUserModal({ isOpen, onClose, onSubmit, isLoading }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('worker');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      await onSubmit({
        username: username.trim(),
        password,
        role
      });
      // Reset form on success
      handleClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleClose = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRole('worker');
    setShowPassword(false);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-slate-800/50 px-6 py-5 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-terminal-green/20 rounded-lg">
                <UserPlus className="w-6 h-6 text-terminal-green" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-100">Create User</h2>
                <p className="text-sm text-slate-400">Add a new user to the system</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-sm text-red-400">{error}</span>
              </div>
            )}

            {/* Username */}
            <div>
              <label htmlFor="new-username" className="block text-sm font-medium text-slate-300 mb-2">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="w-5 h-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  id="new-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green transition-colors"
                  placeholder="Enter username"
                  autoComplete="off"
                  autoFocus
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-slate-500" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green transition-colors"
                  placeholder="Enter password"
                  autoComplete="new-password"
                  disabled={isLoading}
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

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-300 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-slate-500" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green transition-colors"
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Role */}
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-slate-300 mb-2">
                Role
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Shield className="w-5 h-5 text-slate-500" />
                </div>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-terminal-green focus:ring-1 focus:ring-terminal-green transition-colors appearance-none cursor-pointer"
                  disabled={isLoading}
                >
                  <option value="worker">Worker</option>
                  <option value="admin">Admin</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {role === 'admin'
                  ? 'Admins can manage users, run terminal, and execute system scripts'
                  : 'Workers can run projects and predefined command templates'
                }
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="flex-1 py-3 bg-slate-700 text-slate-300 font-medium rounded-lg hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !username || !password || !confirmPassword}
                className="flex-1 py-3 bg-terminal-green text-slate-950 font-semibold rounded-lg hover:bg-terminal-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create User'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
