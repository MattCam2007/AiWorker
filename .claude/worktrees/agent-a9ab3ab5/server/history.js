const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Determine the history file path based on the configured shell.
 * @param {string} [shell] - The shell path (e.g. '/bin/bash', '/bin/zsh')
 * @returns {string} Absolute path to the history file
 */
function getHistoryFilePath(shell) {
  if (shell && shell.indexOf('zsh') !== -1) {
    return path.join(os.homedir(), '.zsh_history');
  }
  return path.join(os.homedir(), '.bash_history');
}

/**
 * Parse raw history file content into a deduplicated array,
 * most recent first.
 * @param {string} raw - Raw file content
 * @returns {string[]} Deduplicated command history, most recent first
 */
function parseHistory(raw) {
  if (!raw || typeof raw !== 'string') return [];

  const lines = raw.split('\n');
  const result = [];
  const seen = new Set();

  // Process in reverse (most recent first)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Skip bash timestamp comments (e.g. #1234567890)
    if (line.charAt(0) === '#') continue;

    // Skip zsh extended history format prefix (: timestamp:0;command)
    // Extract the actual command from zsh format
    let cmd = line;
    const zshMatch = line.match(/^:\s*\d+:\d+;(.*)$/);
    if (zshMatch) {
      cmd = zshMatch[1].trim();
      if (!cmd) continue;
    }

    // Deduplicate: keep only first occurrence (which is most recent)
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    result.push(cmd);
  }

  return result;
}

/**
 * Read and parse a history file. Returns empty array on any error.
 * @param {string} filePath - Absolute path to history file
 * @returns {string[]} Parsed history entries
 */
function readHistory(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseHistory(raw);
  } catch (err) {
    return [];
  }
}

/**
 * Create an HTTP request handler for the /api/history endpoint.
 * @param {string} historyFilePath - Path to the history file
 * @returns {Function} Request handler (req, res)
 */
function createHistoryRoute(historyFilePath) {
  return function (req, res) {
    try {
      const history = readHistory(historyFilePath);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(JSON.stringify(history));
    } catch (err) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(JSON.stringify([]));
    }
  };
}

module.exports = { parseHistory, getHistoryFilePath, readHistory, createHistoryRoute };
