import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import { TerminalProvider } from './contexts/TerminalContext'
import { PersistentTerminal } from './components/PersistentTerminal'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TerminalProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
        </Routes>
        {/* Persistent terminal rendered at app root - survives route changes */}
        <PersistentTerminal />
      </BrowserRouter>
    </TerminalProvider>
  </React.StrictMode>,
)
