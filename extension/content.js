/**
 * Secure Assessment Extension - Content Script Bridge
 * Injects status flag into web app DOM and bridges lockdown commands.
 */

// Inject global status flag into DOM
const script = document.createElement('script');
script.textContent = `
  window.__SECURE_ASSESSMENT_EXTENSION_ACTIVE__ = true;
  window.SecureAssessmentExtension = {
    ping: function() { return true; },
    lockdown: function() {
      window.postMessage({ type: 'SECURE_EXT_LOCKDOWN' }, '*');
    },
    restore: function() {
      window.postMessage({ type: 'SECURE_EXT_RESTORE' }, '*');
    }
  };
`;
(document.head || document.documentElement).appendChild(script);

// Relay messages from DOM to background service worker
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data && event.data.type === 'SECURE_EXT_LOCKDOWN') {
    chrome.runtime.sendMessage({ action: 'LOCKDOWN_EXTENSIONS' }, (response) => {
      window.postMessage({ type: 'SECURE_EXT_LOCKDOWN_RESULT', response }, '*');
    });
  }

  if (event.data && event.data.type === 'SECURE_EXT_RESTORE') {
    chrome.runtime.sendMessage({ action: 'RESTORE_EXTENSIONS' }, (response) => {
      window.postMessage({ type: 'SECURE_EXT_RESTORE_RESULT', response }, '*');
    });
  }
});
