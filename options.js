/**
 * Select Search Extension Options
 */

// Save options to browser.storage
function saveOptions(e) {
  e.preventDefault();
  
  const minOptions = document.getElementById('min-options').value;
  const maxResults = document.getElementById('max-results').value;
  const websiteMode = document.getElementById('website-mode').value;
  const websites = document.getElementById('websites').value
    .split('\n')
    .map(site => site.trim())
    .filter(site => site !== '');
  if (typeof browser === "undefined") {
	var browser = chrome;
  }
  browser.storage.sync.set({
    minOptions: parseInt(minOptions, 10),
    maxResults: parseInt(maxResults, 10),
    websiteMode: websiteMode,
    websites: websites
  }).then(() => {
    // Update status to let user know options were saved
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    status.classList.add('success');
    
    setTimeout(() => {
      status.textContent = '';
      status.classList.remove('success');
    }, 3000);
  });
}

// Restore options from browser.storage
function restoreOptions() {
  browser.storage.sync.get({
    minOptions: 20,
    maxResults: 10,
    websiteMode: 'all',
    websites: []
  }).then((items) => {
    document.getElementById('min-options').value = items.minOptions;
    document.getElementById('max-results').value = items.maxResults;
    document.getElementById('website-mode').value = items.websiteMode;
    document.getElementById('websites').value = items.websites.join('\n');
    
    // Show/hide websites textarea based on mode
    toggleWebsitesVisibility();
  });
}

// Toggle websites textarea visibility based on selected mode
function toggleWebsitesVisibility() {
  const websiteMode = document.getElementById('website-mode').value;
  const websitesContainer = document.getElementById('websites-container');
  
  if (websiteMode === 'all') {
    websitesContainer.style.display = 'none';
  } else {
    websitesContainer.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('options-form').addEventListener('submit', saveOptions);
document.getElementById('website-mode').addEventListener('change', toggleWebsitesVisibility);