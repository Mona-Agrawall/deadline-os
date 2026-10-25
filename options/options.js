// options/options.js
// Settings page: loads the user's settings into the form and saves changes
// through the service worker (which validates them and updates reminders).

const form = document.getElementById('settingsForm');
const statusText = document.getElementById('status');

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(chrome.runtime.lastError ? null : response);
    });
  });
}

function showStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.classList.toggle('error', isError);
}

function fillForm(settings) {
  form.elements.dateOrder.value = settings.dateOrder;
  for (const checkbox of form.querySelectorAll('[name="reminderMinutes"]')) {
    checkbox.checked = settings.reminderMinutes.includes(Number(checkbox.value));
  }
  form.elements.collegeDomains.value = settings.collegeDomains.join('\n');
  form.elements.careerDomains.value = settings.careerDomains.join('\n');
}

function readForm() {
  const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
  return {
    dateOrder: form.elements.dateOrder.value,
    reminderMinutes: [...form.querySelectorAll('[name="reminderMinutes"]:checked')].map(c => Number(c.value)),
    collegeDomains: lines(form.elements.collegeDomains.value),
    careerDomains: lines(form.elements.careerDomains.value),
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saved = await sendMessage({ type: 'SAVE_SETTINGS', settings: readForm() });
  if (!saved) {
    showStatus('Could not save settings.', true);
    return;
  }
  fillForm(saved); // shows the cleaned-up values (invalid domains removed)
  showStatus('✓ Saved');
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  const defaults = await sendMessage({ type: 'RESET_SETTINGS' });
  if (!defaults) {
    showStatus('Could not reset settings.', true);
    return;
  }
  fillForm(defaults);
  showStatus('✓ Defaults restored');
});

(async () => {
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  if (settings) fillForm(settings);
  else showStatus('Could not load settings.', true);
})();
