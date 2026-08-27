/**
 * Secure Assessment Extension - Service Worker
 * Uses chrome.management API to temporarily disable third-party extensions during proctored exams.
 */

const SELF_EXTENSION_ID = chrome.runtime.id;

// Listen to message calls from content script or external web app
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING_EXTENSION') {
    sendResponse({ status: 'ACTIVE', version: '1.0.0', name: 'Secure Assessment Extension' });
    return true;
  }

  if (request.action === 'LOCKDOWN_EXTENSIONS') {
    lockdownOtherExtensions().then((disabledCount) => {
      sendResponse({ success: true, disabledCount });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.action === 'RESTORE_EXTENSIONS') {
    restoreOriginalExtensions().then((restoredCount) => {
      sendResponse({ success: true, restoredCount });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

// Suppress all other extensions using chrome.management
async function lockdownOtherExtensions() {
  const allExtensions = await new Promise((resolve) => {
    chrome.management.getAll((items) => resolve(items));
  });

  const activeOtherExtensions = allExtensions.filter(ext => 
    ext.id !== SELF_EXTENSION_ID && 
    ext.type === 'extension' && 
    ext.enabled &&
    !ext.isApp
  );

  const disabledIds = activeOtherExtensions.map(e => e.id);
  await chrome.storage.local.set({ suppressedExtensionIds: disabledIds });

  // Temporarily disable each third-party extension
  let count = 0;
  for (const extId of disabledIds) {
    try {
      await chrome.management.setEnabled(extId, false);
      count++;
    } catch (err) {
      console.warn(`Could not disable extension ${extId}:`, err);
    }
  }

  return count;
}

// Restore previously disabled extensions
async function restoreOriginalExtensions() {
  const data = await chrome.storage.local.get(['suppressedExtensionIds']);
  const disabledIds = data.suppressedExtensionIds || [];

  let count = 0;
  for (const extId of disabledIds) {
    try {
      await chrome.management.setEnabled(extId, true);
      count++;
    } catch (err) {
      console.warn(`Could not restore extension ${extId}:`, err);
    }
  }

  await chrome.storage.local.remove(['suppressedExtensionIds']);
  return count;
}
