import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import UsersPage from './pages/UsersPage'
import { TerminalProvider } from './contexts/TerminalContext'
import { AuthProvider } from './contexts/AuthContext'
import { PersistentTerminal } from './components/PersistentTerminal'
import { LoginModal } from './components/LoginModal'
import { AuthInitializer } from './components/AuthInitializer'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthInitializer />
      <TerminalProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project/:id" element={<ProjectPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
          </Routes>
          {/* Persistent terminal rendered at app root - survives route changes */}
          <PersistentTerminal />
        </BrowserRouter>
      </TerminalProvider>
      {/* Login modal - shown when authentication is required */}
      <LoginModal />
    </AuthProvider>
  </React.StrictMode>,
)
