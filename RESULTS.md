# Results Tracking

## Overview
The Creative Automation POC now tracks all processing results, including successes and failures, with detailed information for each generated image.

## Results Object Structure

### Summary
```json
{
  "success": [...],
  "failures": [...],
  "summary": {
    "total": 6,        // Total expected outputs
    "processed": 6,    // Actual outputs processed
    "succeeded": 4,    // Successfully generated
    "failed": 2        // Failed to generate
  }
}
```

### Success Entries
Each successful image generation includes:
```json
{
  "assetName": "fragrance_photoroom.png",
  "productCategory": "fragrances",
  "region": "US", 
  "aspectRatio": "1:1",
  "label": "fragrance_photoroom_US_1x1",
  "s3Key": "aar/creative_automation_poc/bold_steps_bright_looks_2025/fragrances/US/1x1/fragrance_photoroom_US_1x1_2025-08-27T10-30-15-123Z.png",
  "presignedGetUrl": "https://acspocbucket.s3.us-east-1.amazonaws.com/...",
  "dimensions": { "width": 2048, "height": 2048 },
  "message": "Captivate Your Essence",
  "timestamp": "2025-08-27T10:30:15.123Z"
}
```

### Failure Entries
Each failed processing includes:
```json
{
  "assetName": "missing_image.png",
  "productCategory": "fragrances",
  "region": "US",
  "aspectRatio": "1:1", 
  "label": "missing_image_US_1x1",
  "error": "Image file not found",
  "timestamp": "2025-08-27T10:30:15.123Z"
}
```

## Output Files

### JSON Results File
- **Location**: `./results-YYYY-MM-DD.json`
- **Content**: Complete results object with all successes and failures
- **Format**: Pretty-printed JSON for easy reading

### Logs
- **Success logs**: Written to main log file with `logger.info()`
- **Failure logs**: Written to both main and error log files
- **Summary**: Final processing summary logged at completion

## Presigned URLs

### Success Images
- **Valid for**: 1 hour (3600 seconds) by default
- **Purpose**: Direct download access to generated images
- **Format**: Standard S3 presigned GET URLs
- **Usage**: Can be used immediately for downloading or viewing results

### Example Usage
```javascript
// Access results after script completion
const results = await main();

// Download all successful images
for (const success of results.success) {
  const response = await fetch(success.presignedGetUrl);
  const imageBuffer = await response.arrayBuffer();
  // Save or process the image
}
```

## Error Types

### Common Failure Reasons
1. **"Image file not found"** - Source asset missing from assets folder
2. **"Empty image file"** - Source asset exists but has 0 bytes
3. **"No configuration found for product category"** - Category not defined in campaign.yaml
4. **API errors** - Adobe Firefly/Photoshop API failures
5. **S3 upload errors** - Network or permissions issues

### Debugging Failures
- Check the `error` field in failure entries for specific error messages
- Review the error log file: `logs/error-YYYY-MM-DD.log`
- Verify source assets exist and are not corrupted
- Confirm campaign.yaml configuration matches folder structure

## Integration

### Programmatic Access
```javascript
import main from './index.js';

const results = await main();
console.log(`Generated ${results.summary.succeeded} successful images`);
console.log(`Failed: ${results.summary.failed}`);

// Process successful results
results.success.forEach(result => {
  console.log(`✅ ${result.label}: ${result.presignedGetUrl}`);
});
```

### Monitoring
- Monitor the `summary.failed` count for automation health
- Alert on high failure rates
- Use presigned URLs for automated quality checks
- Track processing times via timestamps
