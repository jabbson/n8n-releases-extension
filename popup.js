// Constants
const GITHUB_API_BASE = 'https://api.github.com/repos/n8n-io/n8n/releases';
const CACHE_KEY = 'n8n_releases_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
const VERSIONED_TAG_RE = /^(n8n@)?\d+\.\d+\.\d+/;

// Configure marked.js for markdown rendering, links open in new tab
if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  const originalLink = renderer.link.bind(renderer);
  renderer.link = function(href, title, text) {
    const link = originalLink(href, title, text);
    return link.replace('<a href', '<a target="_blank" rel="noopener noreferrer" href');
  };
  
  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
    renderer: renderer
  });
}

// Initialize extension on page load
document.addEventListener('DOMContentLoaded', () => {
  loadReleases();

  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadReleases(true);
  });

  setupSectionToggles();
  restoreToggleState();
});

// Setup collapsible sections for past and pre-releases
function setupSectionToggles() {
  const pastReleasesHeader = document.getElementById('past-releases-header');
  const pastReleasesContent = document.getElementById('past-releases-container');
  const preReleasesHeader = document.getElementById('pre-releases-header');
  const preReleasesContent = document.getElementById('pre-releases-container');

  pastReleasesHeader.addEventListener('click', () => {
    toggleSection(pastReleasesHeader, pastReleasesContent, preReleasesHeader, preReleasesContent);
    saveToggleState();
  });

  preReleasesHeader.addEventListener('click', () => {
    toggleSection(preReleasesHeader, preReleasesContent, pastReleasesHeader, pastReleasesContent);
    saveToggleState();
  });
}

// Toggle section expansion, only one section open at time
function toggleSection(header, content, otherHeader, otherContent) {
  const isExpanded = content.classList.contains('expanded');

  otherContent.classList.remove('expanded');
  otherHeader.classList.remove('expanded');

  if (isExpanded) {
    content.classList.remove('expanded');
    header.classList.remove('expanded');
  } else {
    content.classList.add('expanded');
    header.classList.add('expanded');
  }
}

// Persist which section is open across popup opens
function saveToggleState() {
  const pastExpanded = document.getElementById('past-releases-container').classList.contains('expanded');
  const preExpanded = document.getElementById('pre-releases-container').classList.contains('expanded');
  chrome.storage.local.set({ section_toggle: pastExpanded ? 'past' : preExpanded ? 'pre' : 'none' });
}

function restoreToggleState() {
  chrome.storage.local.get('section_toggle', (result) => {
    const state = result.section_toggle;
    if (state === 'past') {
      document.getElementById('past-releases-container').classList.add('expanded');
      document.getElementById('past-releases-header').classList.add('expanded');
    } else if (state === 'pre') {
      document.getElementById('pre-releases-container').classList.add('expanded');
      document.getElementById('pre-releases-header').classList.add('expanded');
    }
  });
}

// Fetch releases from GitHub API with caching
async function fetchReleases(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await getCachedData();
    if (cached) {
      return cached;
    }
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let stableResponse, allResponse;
    try {
      [stableResponse, allResponse] = await Promise.all([
        fetch(`${GITHUB_API_BASE}/tags/stable`, { signal: controller.signal }),
        fetch(`${GITHUB_API_BASE}?per_page=100`, { signal: controller.signal })
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    if (stableResponse.status === 403 || stableResponse.status === 429 ||
        allResponse.status === 403 || allResponse.status === 429) {
      throw new Error('GitHub API rate limit exceeded. Please wait a few minutes and try again.');
    }
    if (!stableResponse.ok) {
      throw new Error(`Failed to fetch stable release: ${stableResponse.status}`);
    }
    if (!allResponse.ok) {
      throw new Error(`Failed to fetch releases: ${allResponse.status}`);
    }

    const [latestRelease, allReleases] = await Promise.all([stableResponse.json(), allResponse.json()]);

    const isVersionedRelease = r => VERSIONED_TAG_RE.test(r.tag_name);

    const latestVersion = extractVersion(latestRelease);
    const pastReleases = allReleases
      .filter(release => release.prerelease === false && isVersionedRelease(release) && extractVersion(release) !== latestVersion)
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
      .slice(0, 10);

    const preReleases = allReleases
      .filter(release => {
        if (!release.prerelease || !isVersionedRelease(release)) return false;
        const tag = release.tag_name.toLowerCase();
        return !tag.includes('rc') && !tag.includes('-exp');
      })
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
      .slice(0, 10);
    
    const data = {
      latest: latestRelease,
      pastReleases: pastReleases,
      preReleases: preReleases
    };
    
    await cacheData(data);
    
    return data;
  } catch (error) {
    console.error('Error fetching releases:', error);
    throw error;
  }
}

// Cache management for release data storage
async function getCachedData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY, 'cache_timestamp'], (result) => {
      if (result[CACHE_KEY] && result.cache_timestamp) {
        const age = Date.now() - result.cache_timestamp;
        if (age < CACHE_DURATION) {
          resolve(result[CACHE_KEY]);
          return;
        }
      }
      resolve(null);
    });
  });
}

async function cacheData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [CACHE_KEY]: data,
      cache_timestamp: Date.now()
    }, resolve);
  });
}

// Load and display releases in UI, handles loading states
async function loadReleases(forceRefresh = false) {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const contentEl = document.getElementById('content');
  const refreshBtn = document.getElementById('refresh-btn');

  refreshBtn.disabled = true;
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  contentEl.classList.add('hidden');

  try {
    const data = await fetchReleases(forceRefresh);

    displayLatestRelease(data.latest);
    displayPastReleases(data.pastReleases);
    displayPreReleases(data.preReleases);

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (error) {
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    document.getElementById('error-message').textContent =
      error.name === 'AbortError'
        ? 'Request timed out. Check your connection and try again.'
        : `Error loading releases: ${error.message}`;
  } finally {
    refreshBtn.disabled = false;
  }
}

// Display latest release
function displayLatestRelease(release) {
  const container = document.getElementById('latest-release-container');
  container.innerHTML = '';
  
  const releaseEl = createReleaseElement(release, 'latest');
  container.appendChild(releaseEl);
}

// Display past releases
function displayPastReleases(releases) {
  const container = document.getElementById('past-releases-container');
  container.innerHTML = '';
  
  if (releases.length === 0) {
    container.innerHTML = '<div class="no-releases">No past releases found</div>';
    return;
  }
  
  releases.forEach(release => {
    const releaseEl = createReleaseElement(release, 'past');
    container.appendChild(releaseEl);
  });
}

// Display pre-releases
function displayPreReleases(releases) {
  const container = document.getElementById('pre-releases-container');
  container.innerHTML = '';
  
  if (releases.length === 0) {
    container.innerHTML = '<div class="no-releases">No pre-releases found</div>';
    return;
  }
  
  releases.forEach(release => {
    const releaseEl = createReleaseElement(release, 'prerelease');
    container.appendChild(releaseEl);
  });
}

function extractVersion(release) {
  if (VERSIONED_TAG_RE.test(release.tag_name)) {
    return release.tag_name;
  }
  if (release.body) {
    const match = release.body.match(/\b(\d+\.\d+\.\d+)\b/);
    if (match) return `n8n@${match[1]}`;
  }
  return release.name || release.tag_name;
}

// Create DOM element for release display with markdown content
function createReleaseElement(release, releaseType) {
  const releaseDiv = document.createElement('div');
  releaseDiv.className = 'release-item';
  releaseDiv.dataset.releaseId = release.id;
  
  const publishedDate = new Date(release.published_at);
  const formattedDate = publishedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  let badgeClass, badgeText;
  if (releaseType === 'latest') {
    badgeClass = 'badge-latest';
    badgeText = 'Stable';
  } else if (releaseType === 'past') {
    badgeClass = 'badge-past';
    badgeText = 'Past Release';
  } else {
    badgeClass = 'badge-prerelease';
    badgeText = 'Pre-release';
  }
  
  const header = document.createElement('div');
  header.className = 'release-header';
  header.innerHTML = `
    <div class="release-info">
      <div class="release-title">
        ${escapeHtml(extractVersion(release))}
        <span class="release-badge ${badgeClass}">
          ${badgeText}
        </span>
      </div>
      <div class="release-date">Published: ${formattedDate}</div>
    </div>
    <div class="release-toggle">
      <span>Details</span>
      <svg class="toggle-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 9L1 4h10z"/>
      </svg>
    </div>
  `;
  
  const body = document.createElement('div');
  body.className = 'release-body';
  
  const content = document.createElement('div');
  content.className = 'release-content';
  
  const htmlBody = markdownToHtml(release.body || 'No release notes available');
  content.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(htmlBody) : htmlBody;
  
  const links = document.createElement('div');
  links.className = 'release-links';
  links.innerHTML = `
    <a href="${release.html_url}" target="_blank" rel="noopener noreferrer" class="release-link">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      View on GitHub
    </a>
  `;
  
  content.appendChild(links);
  body.appendChild(content);
  
  header.addEventListener('click', () => {
    toggleRelease(releaseDiv, header, body);
  });
  
  releaseDiv.appendChild(header);
  releaseDiv.appendChild(body);
  
  return releaseDiv;
}

// Toggle release details expansion, collapse other releases
function toggleRelease(releaseDiv, header, body) {
  const toggleIcon = header.querySelector('.toggle-icon');
  const isExpanded = body.classList.contains('expanded');
  
  document.querySelectorAll('.release-body.expanded').forEach(el => {
    if (el !== body) {
      el.classList.remove('expanded');
      el.previousElementSibling.classList.remove('expanded');
      el.previousElementSibling.querySelector('.toggle-icon').classList.remove('expanded');
    }
  });
  
  if (isExpanded) {
    body.classList.remove('expanded');
    header.classList.remove('expanded');
    toggleIcon.classList.remove('expanded');
  } else {
    body.classList.add('expanded');
    header.classList.add('expanded');
    toggleIcon.classList.add('expanded');
  }
}

// Convert markdown text to HTML using marked.js
function markdownToHtml(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }
  
  if (typeof marked !== 'undefined') {
    return marked.parse(markdown);
  } else {
    console.error('marked.js is not loaded');
    return escapeHtml(markdown);
  }
}

// Escape HTML characters for safe display, fallback function
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
