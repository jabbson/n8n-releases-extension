# n8n Releases Viewer

A Chrome browser extension that displays the latest releases and pre-releases from the [n8n-io/n8n](https://github.com/n8n-io/n8n) GitHub repository.

<img width="649" height="403" alt="image" src="https://github.com/user-attachments/assets/a07220eb-46ad-408a-b068-1095dfbd5302" />

## Overview

This extension provides a quick and convenient way to view n8n release information directly from your browser. It fetches release data from the GitHub API and displays:

- **Latest Release** - The most recent stable release
- **Past Releases** - The last 10 previous stable releases
- **Pre-releases** - The last 10 pre-releases (excluding RC and experimental tags)

## Features

- View release notes with markdown rendering
- Collapsible sections for better organization
- Caching to reduce API calls
- Manual refresh option
- Direct links to GitHub releases

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory

## Usage

Click the extension icon in your browser toolbar to open the popup and view n8n releases. Use the refresh button to manually update the release information.
