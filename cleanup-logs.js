#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const logDir = './logs';

console.log('🧹 Log File Cleanup Utility\n');

if (!fs.existsSync(logDir)) {
  console.log('❌ No logs directory found.');
  process.exit(0);
}

const files = fs.readdirSync(logDir)
  .filter(file => file.endsWith('.log'))
  .map(file => ({
    name: file,
    path: path.join(logDir, file),
    size: fs.statSync(path.join(logDir, file)).size,
    mtime: fs.statSync(path.join(logDir, file)).mtime
  }))
  .sort((a, b) => b.mtime - a.mtime);

if (files.length === 0) {
  console.log('✅ No log files found.');
  process.exit(0);
}

console.log(`Found ${files.length} log files:\n`);

// Group files by type and date
const fileGroups = {
  current: [],
  old: [],
  rotated: []
};

const today = new Date().toISOString().slice(0, 10);

files.forEach(file => {
  if (file.name.includes(today)) {
    fileGroups.current.push(file);
  } else if (file.name.includes('2025-08-27') || file.name.includes('2025-08-28')) {
    // Recent files but not today
    fileGroups.old.push(file);
  } else {
    // Rotated files with timestamps
    fileGroups.rotated.push(file);
  }
});

// Display file groups
if (fileGroups.current.length > 0) {
  console.log('📅 TODAY\'S FILES (keep these):');
  fileGroups.current.forEach(file => {
    console.log(`   ✅ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  });
  console.log();
}

if (fileGroups.old.length > 0) {
  console.log('📁 RECENT FILES:');
  fileGroups.old.forEach(file => {
    console.log(`   📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  });
  console.log();
}

if (fileGroups.rotated.length > 0) {
  console.log('🔄 ROTATED/TIMESTAMPED FILES (safe to delete):');
  fileGroups.rotated.forEach(file => {
    console.log(`   🗑️  ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  });
  console.log();
}

// Cleanup options
console.log('🛠️  CLEANUP OPTIONS:\n');

const args = process.argv.slice(2);

if (args.includes('--auto')) {
  // Auto cleanup mode
  console.log('🤖 AUTO CLEANUP MODE');
  
  // Keep only today's files and last 2 days
  const filesToDelete = files.filter(file => {
    const fileDate = file.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (!fileDate) return true; // Delete if no date pattern
    
    const daysDiff = Math.floor((Date.now() - new Date(fileDate[1])) / (1000 * 60 * 60 * 24));
    return daysDiff > 2; // Delete files older than 2 days
  });
  
  if (filesToDelete.length === 0) {
    console.log('✅ No files need cleanup.');
  } else {
    console.log(`🗑️  Deleting ${filesToDelete.length} old files...`);
    filesToDelete.forEach(file => {
      fs.unlinkSync(file.path);
      console.log(`   ❌ Deleted: ${file.name}`);
    });
    console.log('✅ Cleanup completed!');
  }
  
} else if (args.includes('--rotated')) {
  // Delete only rotated files
  console.log('🔄 CLEANING ROTATED FILES');
  
  if (fileGroups.rotated.length === 0) {
    console.log('✅ No rotated files to clean.');
  } else {
    fileGroups.rotated.forEach(file => {
      fs.unlinkSync(file.path);
      console.log(`   ❌ Deleted: ${file.name}`);
    });
    console.log(`✅ Deleted ${fileGroups.rotated.length} rotated files!`);
  }
  
} else if (args.includes('--all')) {
  // Delete all files
  console.log('💥 DELETING ALL LOG FILES');
  
  files.forEach(file => {
    fs.unlinkSync(file.path);
    console.log(`   ❌ Deleted: ${file.name}`);
  });
  console.log(`✅ Deleted all ${files.length} log files!`);
  
} else {
  // Show help
  console.log('Usage:');
  console.log('  node cleanup-logs.js --auto     # Keep last 2 days only');
  console.log('  node cleanup-logs.js --rotated  # Delete only rotated files'); 
  console.log('  node cleanup-logs.js --all      # Delete all log files');
  console.log('  node cleanup-logs.js            # Show this help');
  console.log('\n💡 Recommendation: Use --auto for regular cleanup');
}

console.log('\n📊 SUMMARY:');
console.log(`   Current files: ${fileGroups.current.length}`);
console.log(`   Recent files: ${fileGroups.old.length}`);
console.log(`   Rotated files: ${fileGroups.rotated.length}`);
console.log(`   Total: ${files.length} files`);

const totalSize = files.reduce((sum, file) => sum + file.size, 0);
console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
