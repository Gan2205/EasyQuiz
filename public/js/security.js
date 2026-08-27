/**
 * EasyQuiz Client-Side Security Proctoring & Lockdown Engine
 * Enterprise Fullscreen Lock, Focus Guardian, Key Traps, Anti-Copy, and Real-Time WebSocket Unblock.
 */

window.SecurityEngine = (function() {
  let isProctorActive = false;
  let currentUsername = null;
  let currentQuizId = null;
  let tabSwitchCount = 0;
  let socket = null;
  let onLockoutCallback = null;
  let onUnblockCallback = null;
  let audioContext = null;
  let extensionCheckInterval = null;

  // Synthesize Subtle Enterprise Audio Alert Tone
  function playWarningSound() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, audioContext.currentTime + 0.35);
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.35);
    } catch (e) {
      console.warn('Audio feedback unavailable:', e);
    }
  }

  // Report Security Incident to Server
  async function reportIncident(type, details) {
    if (!currentUsername || !currentQuizId) return;
    try {
      const res = await fetch('/api/exam/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUsername,
          quizId: currentQuizId,
          violationType: type,
          details: details || ''
        })
      });
      const data = await res.json();
      if (isProctorActive && data.session && data.session.status === 'BLOCKED') {
        triggerLockout(data.session.blockedReason || 'Assessment suspended due to security policy violations.');
      }
      return data;
    } catch (err) {
      console.error('Failed to commit incident record:', err);
    }
  }

  // Initialize Real-Time WebSocket Connection
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      if (currentUsername) {
        socket.send(JSON.stringify({ type: 'REGISTER_STUDENT', username: currentUsername }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'EXAM_UNBLOCKED') {
          handleUnblockEvent();
        } else if (msg.type === 'EXAM_BLOCKED') {
          triggerLockout('Assessment access restricted by Administrator.');
        }
      } catch (e) {
        console.error('WS Parse error:', e);
      }
    };

    socket.onclose = () => {
      setTimeout(initWebSocket, 3000);
    };
  }

  let pollUnblockStatusInterval = null;

  function startUnblockPolling() {
    if (pollUnblockStatusInterval) clearInterval(pollUnblockStatusInterval);
    pollUnblockStatusInterval = setInterval(async () => {
      if (!currentUsername || !currentQuizId) return;
      try {
        const res = await fetch(`/api/exam/session-status?username=${encodeURIComponent(currentUsername)}&quizId=${encodeURIComponent(currentQuizId)}`);
        const data = await res.json();
        if (data.success && data.session) {
          if (data.session.status === 'IN_PROGRESS') {
            stopUnblockPolling();
            handleUnblockEvent();
          }
        }
      } catch (e) {}
    }, 2000);
  }

  function stopUnblockPolling() {
    if (pollUnblockStatusInterval) {
      clearInterval(pollUnblockStatusInterval);
      pollUnblockStatusInterval = null;
    }
  }

  function triggerLockout(reason) {
    isProctorActive = false;
    playWarningSound();
    reportIncident('EXAM_BLOCKED', reason);
    startUnblockPolling();
    if (onLockoutCallback) {
      onLockoutCallback(reason);
    }
  }

  function handleUnblockEvent() {
    isProctorActive = false;
    isEnteringFullscreen = false;
    tabSwitchCount = 0;
    stopUnblockPolling();
    hideWarningModal();
    const modalEl = document.getElementById('security-warning-modal');
    if (modalEl) modalEl.classList.add('hidden');
    if (onUnblockCallback) {
      onUnblockCallback();
    }
  }

  // Enhanced Key Interception Handler
  let isMetaPressed = false;

  function handleKeyDown(e) {
    if (!isProctorActive) return;

    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code ? e.code.toLowerCase() : '';

    if (e.key === 'Meta' || e.key === 'OS' || e.key === 'Win' || e.code === 'MetaLeft' || e.code === 'MetaRight' || e.metaKey) {
      isMetaPressed = true;
    }

    // 1. Trap Win Key / Win + G (Windows Game Bar) -> DIRECT INSTANT LOCKOUT (NO EXCUSES)
    if (isMetaPressed || e.metaKey || (e.key === 'Meta' || e.key === 'OS' || e.key === 'Win') || ((isMetaPressed || e.metaKey) && (key === 'g' || code === 'keyg'))) {
      e.preventDefault();
      e.stopPropagation();
      tabSwitchCount = 2;
      playWarningSound();
      reportIncident('WIN_G_ATTEMPT', 'Win Key / Win + G Attempt - EXAM SUSPENDED IMMEDIATELY');
      triggerLockout('Assessment access suspended immediately due to prohibited Windows key or Win+G attempt.');
      return false;
    }

    // 2. Trap Win + Shift + S / Win + Alt + R (Screen Recording & Snipping Tool) -> DIRECT LOCKOUT
    if ((isMetaPressed || e.metaKey) && (key === 's' || key === 'r' || key === 'prtscr')) {
      e.preventDefault();
      e.stopPropagation();
      tabSwitchCount = 2;
      playWarningSound();
      reportIncident('BLOCKED_KEY', `Windows OS capture shortcut (Win+${key.toUpperCase()}) - EXAM SUSPENDED IMMEDIATELY`);
      triggerLockout(`Assessment access suspended immediately due to prohibited screen capture shortcut (Win+${key.toUpperCase()}).`);
      return false;
    }

    // 3. Block Shift + Insert, Ctrl + Insert, Shift + Delete
    if ((e.shiftKey && (key === 'insert' || code === 'insert')) ||
        (e.ctrlKey && (key === 'insert' || code === 'insert')) ||
        (e.shiftKey && (key === 'delete' || code === 'delete'))) {
      e.preventDefault();
      e.stopPropagation();
      playWarningSound();
      reportIncident('BLOCKED_KEY', 'Shift+Insert / Clipboard shortcut trapped');
      return false;
    }

    // 4. Block Ctrl/Cmd + C, V, X, A, P, U
    if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a', 'p', 'u'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();
      playWarningSound();
      reportIncident('BLOCKED_KEY', `Ctrl+${key.toUpperCase()} shortcut trapped`);
      return false;
    }

    // 5. Block DevTools Shortcuts: F12, Ctrl+Shift+I, J, C
    if (key === 'f12' || 
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(key))) {
      e.preventDefault();
      e.stopPropagation();
      playWarningSound();
      reportIncident('BLOCKED_KEY', 'Developer Tools shortcut trapped');
      return false;
    }

    // 6. Block PrintScreen
    if (key === 'printscreen' || code === 'printscreen') {
      e.preventDefault();
      e.stopPropagation();
      reportIncident('BLOCKED_KEY', 'PrintScreen key trapped');
      return false;
    }

    // 7. Trap Escape Key
    if (key === 'escape' || code === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }

  function handleKeyUp(e) {
    if (e.key === 'Meta' || e.key === 'OS' || e.key === 'Win') {
      isMetaPressed = false;
    }
  }

  function preventDefaults(e) {
    if (!isProctorActive) return;
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  // Focus Loss & Tab Switch Guardian
  function handleVisibilityOrBlur(e) {
    if (!isProctorActive || isEnteringFullscreen) return;

    if (document.hidden || e.type === 'blur') {
      tabSwitchCount++;
      playWarningSound();

      if (tabSwitchCount === 1) {
        reportIncident('TAB_SWITCH', '1st Focus Loss Warning');
        showWarningModal('Focus Loss Warning (1/1): Browser focus loss detected. A second occurrence will lock your assessment.');
      } else if (tabSwitchCount >= 2) {
        reportIncident('TAB_SWITCH', '2nd Focus Loss - EXAM SUSPENDED');
        triggerLockout('Assessment access suspended due to repeated focus loss or tab switching.');
      }
    }
  }

  let isEnteringFullscreen = false;

  function handleFullscreenChange() {
    if (!isProctorActive || isEnteringFullscreen) return;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
      tabSwitchCount++;
      playWarningSound();

      if (tabSwitchCount === 1) {
        reportIncident('FULLSCREEN_EXIT', '1st Fullscreen Exit Warning');
        showWarningModal('Security Warning (1/1): Viewport exited Fullscreen mode. A second Fullscreen exit or focus loss will LOCK your assessment.');
      } else if (tabSwitchCount >= 2) {
        reportIncident('FULLSCREEN_EXIT', '2nd Fullscreen Exit - EXAM SUSPENDED');
        triggerLockout('Assessment access suspended due to repeated viewport Fullscreen exits.');
      }
    }
  }

  // Advanced Anti-Cheat Tamper & Extension Guardian
  function checkForActiveExtensions() {
    if (!isProctorActive) return;

    let detectedExtension = null;

    // 1. Detect "Always Active Window" & Focus-Spoofing Extensions
    try {
      if (document.hasOwnProperty('hidden') || 
          document.hasOwnProperty('visibilityState') ||
          (typeof document.hasFocus === 'function' && !document.hasFocus.toString().includes('[native code]'))) {
        detectedExtension = 'Always Active Window (Focus-Spoofing Extension)';
      }
    } catch (e) {}

    // 2. Detect Event Listener Prototype Tampering
    try {
      if (!EventTarget.prototype.addEventListener.toString().includes('[native code]') ||
          !document.addEventListener.toString().includes('[native code]')) {
        detectedExtension = 'Event Interceptor Extension';
      }
    } catch (e) {}

    // 3. Scan DOM Attributes & Global Scopes
    const htmlAttrs = document.documentElement.getAttributeNames();
    const bodyAttrs = document.body.getAttributeNames();
    const allAttrs = [...htmlAttrs, ...bodyAttrs].join(' ').toLowerCase();

    const extensionGlobals = [
      '__grammarly', '__gCrWeb', 'googleTranslateElementInit', 
      '__REDUX_DEVTOOLS_EXTENSION__', '__REACT_DEVTOOLS_GLOBAL_HOOK__'
    ];

    extensionGlobals.forEach(g => {
      if (window[g]) detectedExtension = `Extension (${g})`;
    });

    if (allAttrs.includes('data-extension-id') || allAttrs.includes('grammarly') || allAttrs.includes('data-gr-ext')) {
      detectedExtension = 'Injected Extension Attribute';
    }

    if (detectedExtension) {
      reportIncident('EXTENSION_DETECTED', `Unauthorized extension active: ${detectedExtension} - EXAM SUSPENDED`);
      triggerLockout(`Assessment access suspended: Prohibited extension (${detectedExtension}) detected. Disable browser extensions to continue.`);
    }
  }

  let observer = null;
  function startMutationObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      if (!isProctorActive) return;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const tag = node.tagName.toLowerCase();
            const id = (node.id || '').toLowerCase();
            const className = (node.className || '').toString().toLowerCase();
            
            if (tag === 'iframe' || 
                id.includes('grammarly') || 
                id.includes('translate') || 
                id.includes('solver') ||
                className.includes('solver') ||
                id.includes('copilot') ||
                id.includes('chatgpt')) {
              try { node.remove(); } catch (err) {}
            }
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    checkForActiveExtensions();
  }

  function showWarningModal(message) {
    isProctorActive = false;
    let modal = document.getElementById('security-warning-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'security-warning-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="modal-content">
        <div style="width: 52px; height: 52px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1rem; color: var(--status-warning);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h3 class="modal-title" style="color: #fff; font-size: 1.3rem;">Proctoring Warning (1/1)</h3>
        <p class="modal-desc" style="font-size: 0.9rem; margin-top: 0.5rem; margin-bottom: 1.5rem;">${message}</p>
        <button class="btn btn-primary" onclick="SecurityEngine.reEnterFullscreen()">Re-Enter Fullscreen & Resume</button>
      </div>
    `;
    modal.classList.remove('hidden');
  }

  function hideWarningModal() {
    const modal = document.getElementById('security-warning-modal');
    if (modal) modal.classList.add('hidden');
  }

  return {
    init: function(username, quizId, callbacks) {
      currentUsername = username;
      currentQuizId = quizId;
      onLockoutCallback = callbacks ? callbacks.onLockout : null;
      onUnblockCallback = callbacks ? callbacks.onUnblock : null;
      tabSwitchCount = 0;

      initWebSocket();
    },

    startProctoring: async function() {
      tabSwitchCount = 0;
      isEnteringFullscreen = true;
      isProctorActive = false;
      document.body.classList.add('unselectable');

      // 1. Request Fullscreen
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          await document.documentElement.webkitRequestFullscreen();
        }
      } catch (err) {
        console.warn('Fullscreen request rejected by browser gesture policy:', err);
      }

      // 2. Lock Keyboard Shortcuts
      if (navigator.keyboard && typeof navigator.keyboard.lock === 'function') {
        try {
          await navigator.keyboard.lock(['MetaLeft', 'MetaRight', 'KeyG', 'Tab', 'AltLeft', 'AltRight', 'Escape']);
        } catch (e) {
          console.warn('Keyboard lock unavailable:', e);
        }
      }

      // 3. Attach Event Listeners
      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('keyup', handleKeyUp, true);
      window.addEventListener('blur', handleVisibilityOrBlur);
      document.addEventListener('visibilitychange', handleVisibilityOrBlur);
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

      document.addEventListener('contextmenu', preventDefaults);
      document.addEventListener('copy', preventDefaults);
      document.addEventListener('cut', preventDefaults);
      document.addEventListener('paste', preventDefaults);
      document.addEventListener('selectstart', preventDefaults);
      document.addEventListener('dragstart', preventDefaults);
      document.addEventListener('drop', preventDefaults);

      startMutationObserver();

      if (extensionCheckInterval) clearInterval(extensionCheckInterval);
      extensionCheckInterval = setInterval(checkForActiveExtensions, 2000);

      await new Promise(r => setTimeout(r, 600));
      tabSwitchCount = 0;
      isEnteringFullscreen = false;
      isProctorActive = true;
    },

    stopProctoring: function() {
      isProctorActive = false;
      isEnteringFullscreen = false;
      if (extensionCheckInterval) clearInterval(extensionCheckInterval);
      document.body.classList.remove('unselectable');

      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleVisibilityOrBlur);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);

      document.removeEventListener('contextmenu', preventDefaults);
      document.removeEventListener('copy', preventDefaults);
      document.removeEventListener('cut', preventDefaults);
      document.removeEventListener('paste', preventDefaults);
      document.removeEventListener('selectstart', preventDefaults);
      document.removeEventListener('dragstart', preventDefaults);
      document.removeEventListener('drop', preventDefaults);

      if (observer) observer.disconnect();

      if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') {
        try { navigator.keyboard.unlock(); } catch (e) {}
      }

      if (document.fullscreenElement) {
        try { document.exitFullscreen(); } catch (e) {}
      }
    },

    reEnterFullscreen: async function() {
      tabSwitchCount = 0;
      isEnteringFullscreen = true;
      isProctorActive = false;
      hideWarningModal();
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          await document.documentElement.webkitRequestFullscreen();
        }
      } catch (e) {
        console.warn('Re-enter fullscreen error:', e);
      }
      await new Promise(r => setTimeout(r, 600));
      tabSwitchCount = 0;
      isEnteringFullscreen = false;
      isProctorActive = true;
    },

    unblockManually: async function(masterCode) {
      try {
        const res = await fetch('/api/exam/admin-code-unblock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUsername,
            quizId: currentQuizId,
            masterCode
          })
        });
        const data = await res.json();
        if (data.success) {
          handleUnblockEvent();
          return { success: true };
        } else {
          return { success: false, message: data.message };
        }
      } catch (err) {
        return { success: false, message: 'Server error during authorization.' };
      }
    },

    startUnblockPolling: function() {
      startUnblockPolling();
    }
  };
})();
