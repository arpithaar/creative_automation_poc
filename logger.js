import fs from 'node:fs';
import path from 'node:path';

// Simple logging utility
class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logDir = process.env.LOG_DIR || './logs';
    this.maxFileSize = parseInt(process.env.LOG_MAX_SIZE) || 10 * 1024 * 1024; // 10MB default
    this.maxFiles = parseInt(process.env.LOG_MAX_FILES) || 5; // Keep 5 files default
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };

    // Ensure log directory exists
    this.ensureLogDirectory();
    
    // Set up log file paths
    this.setupLogFiles();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  setupLogFiles() {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    this.currentLogFile = path.join(this.logDir, `app-${timestamp}.log`);
    this.currentErrorFile = path.join(this.logDir, `error-${timestamp}.log`);
  }

  rotateLogFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    const stats = fs.statSync(filePath);
    if (stats.size >= this.maxFileSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const rotatedFile = path.join(this.logDir, `${base}-${timestamp}${ext}`);
      
      fs.renameSync(filePath, rotatedFile);
      this.cleanOldFiles();
    }
  }

  cleanOldFiles() {
    const files = fs.readdirSync(this.logDir)
      .filter(file => file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(this.logDir, file),
        mtime: fs.statSync(path.join(this.logDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // Keep only the specified number of files
    if (files.length > this.maxFiles) {
      const filesToDelete = files.slice(this.maxFiles);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
      });
    }
  }

  writeToFile(filePath, message) {
    try {
      this.rotateLogFile(filePath);
      fs.appendFileSync(filePath, message + '\n');
    } catch (error) {
      // Fallback to console if file writing fails
      console.error('Failed to write to log file:', error);
    }
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ') : '';
    
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${formattedArgs}`;
  }

  shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  error(message, ...args) {
    if (this.shouldLog('error')) {
      const formattedMessage = this.formatMessage('error', message, ...args);
      console.error(formattedMessage);
      this.writeToFile(this.currentErrorFile, formattedMessage);
      this.writeToFile(this.currentLogFile, formattedMessage); // Also write to main log
    }
  }

  warn(message, ...args) {
    if (this.shouldLog('warn')) {
      const formattedMessage = this.formatMessage('warn', message, ...args);
      console.warn(formattedMessage);
      this.writeToFile(this.currentLogFile, formattedMessage);
    }
  }

  info(message, ...args) {
    if (this.shouldLog('info')) {
      const formattedMessage = this.formatMessage('info', message, ...args);
      console.log(formattedMessage);
      this.writeToFile(this.currentLogFile, formattedMessage);
    }
  }

  debug(message, ...args) {
    if (this.shouldLog('debug')) {
      const formattedMessage = this.formatMessage('debug', message, ...args);
      console.log(formattedMessage);
      this.writeToFile(this.currentLogFile, formattedMessage);
    }
  }

  // Removed specialized methods - using logger.info directly
}

// Create singleton instance
const logger = new Logger();

export default logger;
