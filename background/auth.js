// background/auth.js
// Google sign-in through chrome.identity. A single OAuth token covers both
// the Gmail and Calendar scopes declared in manifest.json.

const Auth = (() => {

  // interactive = true shows Google's sign-in popup if needed
  function getToken(interactive = false) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error(chrome.runtime.lastError?.message || 'No token returned'));
          return;
        }
        resolve(token);
      });
    });
  }

  function removeCachedToken(token) {
    return new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
  }

  async function isAuthenticated() {
    try {
      await getToken(false);
      return true;
    } catch {
      return false;
    }
  }

  async function authenticate() {
    try {
      await getToken(true);
      return { success: true };
    } catch (e) {
      console.error('[Auth] Sign-in failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  // fetch() with the user's token attached. If the token has expired (401),
  // it is dropped from Chrome's cache and the request is retried once.
  async function authorizedFetch(url, options = {}) {
    let token;
    try {
      token = await getToken(false);
    } catch {
      throw new Error('Not authenticated. User needs to log in.');
    }

    const request = (accessToken) => fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
    });

    const response = await request(token);
    if (response.status !== 401) return response;

    await removeCachedToken(token);
    return request(await getToken(false));
  }

  return { isAuthenticated, authenticate, authorizedFetch };
})();
