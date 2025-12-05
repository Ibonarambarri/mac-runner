import { useState, useRef, useEffect } from 'react';
import { User, LogOut, Shield, ChevronDown, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * UserMenu Component
 *
 * Dropdown menu showing current user info with logout option.
 * Displayed in the header when authenticated.
 *
 * @param {function} onCreateUser - Callback to open Create User modal (admin only)
 */
export function UserMenu({ onCreateUser }) {
  const { user, logout, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isAuthenticated || !user) return null;

  const isAdmin = user.role === 'admin';

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
      >
        <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center">
          <User className="w-4 h-4" />
        </div>
        <span className="hidden sm:inline text-sm font-medium">{user.username}</span>
        {isAdmin && (
          <Shield className="w-4 h-4 text-terminal-green hidden sm:inline" title="Admin" />
        )}
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50">
          {/* User Info */}
          <div className="px-4 py-3 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-100">{user.username}</p>
                <div className="flex items-center gap-1.5">
                  {isAdmin ? (
                    <>
                      <Shield className="w-3 h-3 text-terminal-green" />
                      <span className="text-xs text-terminal-green">Administrator</span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">Worker</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            {/* Create User - Admin only */}
            {isAdmin && onCreateUser && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onCreateUser();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:text-slate-100 hover:bg-slate-700/50 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span className="text-sm">Create User</span>
              </button>
            )}

            {/* Sign Out */}
            <button
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:text-slate-100 hover:bg-slate-700/50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm">Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
