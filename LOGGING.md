# Logging Implementation

## Overview
Structured logging with file output and rotation has been implemented across the Creative Automation POC using a custom logger utility.

## Logger Features

### Log Levels
- **ERROR**: Critical errors and failures
- **WARN**: Warning messages  
- **INFO**: General information (default level)
- **DEBUG**: Detailed debugging information

### Basic Methods
- `logger.error(message, details)` - Log errors
- `logger.warn(message, details)` - Log warnings  
- `logger.info(message, details)` - Log general information
- `logger.debug(message, details)` - Log debug information

### Configuration
Configure logging via environment variables:
```bash
# Log level (default: info)
export LOG_LEVEL=debug  # error, warn, info, debug

# Log directory (default: ./logs)
export LOG_DIR=./logs

# Maximum file size before rotation (default: 10MB)
export LOG_MAX_SIZE=10485760

# Maximum number of log files to keep (default: 5)
export LOG_MAX_FILES=5
```

## Log Format
```
[2025-08-26T23:15:30.123Z] INFO: Found 2 image(s) in assets folder {"files":["fragrance_photoroom.png","nike_air_max.png"]}
[2025-08-26T23:15:31.456Z] INFO: uploadImage: Starting upload {"filename":"fragrance_photoroom.png","size":"111454 bytes"}
[2025-08-26T23:15:32.789Z] INFO: Step 1: Expanding image {"label":"fragrance_photoroom_US_1x1","targetSize":"2048x2048"}
```

## Usage Examples

```javascript
import logger from './logger.js';

// Basic logging
logger.info("Operation completed");
logger.error("Something went wrong", error);

// Structured logging with context
logger.info("Step 1: Image upload", { filename, size: "1MB" });
logger.info("S3 Upload completed", { s3Key, bucket: "my-bucket" });
```

## Log Files

### File Structure
```
logs/
├── app-2025-08-26.log          # All logs (info, warn, debug, error)
├── error-2025-08-26.log        # Error logs only
├── app-2025-08-26-<timestamp>.log  # Rotated files (when size limit reached)
└── error-2025-08-26-<timestamp>.log
```

### File Rotation
- **Size-based rotation**: Files rotate when they exceed the configured size (default: 10MB)
- **Daily files**: New files created each day with date in filename
- **Automatic cleanup**: Old files are automatically deleted (keeps last 5 by default)
- **Separate error logs**: Errors are written to both main log and dedicated error log

### Output Locations
- **Console**: All logs appear in terminal (unchanged)
- **Main Log File**: `logs/app-YYYY-MM-DD.log` (all log levels)
- **Error Log File**: `logs/error-YYYY-MM-DD.log` (errors only)

## Files Updated
- `logger.js` - Core logging utility with file output
- `index.js` - Main application logging
- `firefly-utils.js` - Utility function logging

## Log Management Utility

### Cleanup Tool
Use the included `cleanup-logs.js` utility to manage log files:

```bash
# Show log status and options
node cleanup-logs.js

# Automatic cleanup (keep last 2 days)
node cleanup-logs.js --auto

# Clean only rotated files
node cleanup-logs.js --rotated

# Remove all logs (use with caution)
node cleanup-logs.js --all
```

## Benefits
- ✅ Structured, timestamped logs
- ✅ Configurable log levels
- ✅ **Daily log files** (no more per-run clutter)
- ✅ **File output with automatic rotation**
- ✅ **Separate error logs for easy debugging**
- ✅ **Built-in cleanup utility**
- ✅ Simple, consistent logging with logger.info
- ✅ JSON formatting for easy parsing
- ✅ No external dependencies
