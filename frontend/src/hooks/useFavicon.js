import { useEffect, useRef } from 'react';

/**
 * Dynamic favicon generator using canvas
 */
function generateFavicon(status) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f172a'; // slate-900
  ctx.fillRect(0, 0, 32, 32);

  // Status indicator
  const centerX = 16;
  const centerY = 16;
  const radius = 10;

  switch (status) {
    case 'running':
      // Green pulsing dot
      ctx.fillStyle = '#22c55e'; // terminal-green
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      // Add a subtle glow
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 10;
      ctx.fill();
      break;

    case 'failed':
    case 'error':
      // Red dot
      ctx.fillStyle = '#ef4444'; // red-500
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'cloning':
      // Blue dot (syncing)
      ctx.fillStyle = '#3b82f6'; // blue-500
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      break;

    default:
      // Gray dot (idle)
      ctx.fillStyle = '#64748b'; // slate-500
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

/**
 * Hook to manage dynamic favicon and document title based on job status
 *
 * @param {Array} projects - Array of project objects with status
 * @param {Object} projectJobs - Map of project_id to jobs array
 */
export function useFavicon(projects, projectJobs = {}) {
  const linkRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    // Get or create favicon link element
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      document.head.appendChild(link);
    }
    linkRef.current = link;

    // Determine overall status
    const hasRunning = projects.some(p => p.status === 'running');
    const hasCloning = projects.some(p => p.status === 'cloning');
    const hasError = projects.some(p => p.status === 'error');

    // Check for failed jobs in recent history
    const hasFailed = Object.values(projectJobs).some(jobs =>
      jobs && jobs[0]?.status === 'failed'
    );

    let status = 'idle';
    if (hasRunning) {
      status = 'running';
    } else if (hasCloning) {
      status = 'cloning';
    } else if (hasError || hasFailed) {
      status = 'failed';
    }

    // Update document title
    const baseTitle = 'MacRunner';
    switch (status) {
      case 'running':
        document.title = `▶ Running - ${baseTitle}`;
        break;
      case 'cloning':
        document.title = `⟳ Cloning - ${baseTitle}`;
        break;
      case 'failed':
        document.title = `✗ Failed - ${baseTitle}`;
        break;
      default:
        document.title = baseTitle;
    }

    // Clear any existing animation
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    // Generate and set favicon
    if (status === 'running') {
      // Animate the running favicon
      let frame = 0;
      const animate = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 32, 32);

        // Pulsing green dot
        const scale = 0.8 + 0.2 * Math.sin(frame * 0.3);
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(16, 16, 10 * scale, 0, Math.PI * 2);
        ctx.fill();

        link.href = canvas.toDataURL('image/png');
        frame++;
      };

      animate();
      animationRef.current = setInterval(animate, 100);
    } else {
      link.href = generateFavicon(status);
    }

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [projects, projectJobs]);
}

export default useFavicon;
