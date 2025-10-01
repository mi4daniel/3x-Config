#!/usr/bin/env node
const { execSync } = require('child_process');
const { readFileSync } = require('fs');

function getTrackedFiles() {
  try {
    const output = execSync('git ls-files', { encoding: 'utf8' });
    return output.split('\n').filter(Boolean);
  } catch (error) {
    console.error('Unable to list tracked files:', error.message);
    process.exit(2);
  }
}

function findConflictMarkers(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const markers = ['<<<<<<<', '=======', '>>>>>>>'];
    const hits = [];

    lines.forEach((line, index) => {
      const marker = markers.find(token => line.startsWith(token));
      if (marker) {
        hits.push({ lineNumber: index + 1, marker });
      }
    });

    return hits;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    if (error.code === 'EISDIR') {
      return [];
    }

    if (error.code === 'ERR_INVALID_ARG_VALUE') {
      return [];
    }

    console.warn(`Skipping ${filePath}: ${error.message}`);
    return [];
  }
}

const files = getTrackedFiles();
const conflicts = [];

files.forEach(file => {
  const hits = findConflictMarkers(file);
  if (hits.length) {
    conflicts.push({ file, hits });
  }
});

if (conflicts.length === 0) {
  console.log('No merge conflict markers found.');
  process.exit(0);
}

console.error('Merge conflict markers detected:');
conflicts.forEach(({ file, hits }) => {
  hits.forEach(({ lineNumber, marker }) => {
    console.error(`  ${file}:${lineNumber} contains ${marker}`);
  });
});
process.exit(1);
