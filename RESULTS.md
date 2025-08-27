# Results Tracking

## Overview
The Creative Automation POC tracks all processing results using an optimized **hybrid approach** that combines parallel processing with selective sequencing. Results include detailed information for each generated image with processing step tracking.

## Results Object Structure

### Summary
```json
{
  "success": [...],
  "failures": [...],
  "summary": {
    "total": 18,       // Total expected outputs (6 per aspect ratio: 1:1, 9:16, 16:9)
    "processed": 18,   // Actual outputs processed
    "succeeded": 15,   // Successfully generated
    "failed": 3        // Failed to generate
  }
}
```

### Aspect Ratio Processing
The system generates assets for all configured aspect ratios using Firefly-supported dimensions:
- **1:1** - Square format (2048x2048) for social media posts
- **9:16** - Portrait format (1792x2304) for mobile stories and reels  
- **16:9** - Landscape format (2688x1512) for web banners and presentations

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
  "assetType": "local",
  "isGenerated": false,
  "processingSteps": ["upload", "expand", "mask", "fill", "text_overlay"],
  "timestamp": "2025-08-27T10:30:15.123Z"
}
```

### Generated Asset Entries
AI-generated assets have optimized processing:
```json
{
  "assetName": "shoes_generated_1x1.jpg",
  "productCategory": "shoes",
  "region": "US",
  "aspectRatio": "1:1", 
  "label": "shoes_generated_US_1x1",
  "s3Key": "aar/creative_automation_poc/bold_steps_signature_scents_2025/shoes/US/1x1/shoes_generated_US_1x1_2025-08-27T18-24-52-639Z.jpg",
  "presignedGetUrl": "https://acspocbucket.s3.us-east-1.amazonaws.com/...",
  "dimensions": { "width": 2048, "height": 2048 },
  "message": "Step Into Your Power",
  "assetType": "generated",
  "isGenerated": true,
  "processingSteps": ["text_overlay"],
  "timestamp": "2025-08-27T18:24:52.639Z"
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
  "assetType": "local",
  "isGenerated": false,
  "timestamp": "2025-08-27T10:30:15.123Z"
}
```

## Output Files

### JSON Results File
- **Location**: `./results-hybrid-YYYY-MM-DD_HH-MM-SS.json`
- **Content**: Complete results object with all successes and failures
- **Format**: Pretty-printed JSON for easy reading
- **Processing Info**: Includes processing steps and asset type information

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
4. **"Failed to load asset"** - Error downloading generated asset from S3
5. **API errors** - Adobe Firefly/Photoshop API failures
6. **S3 upload errors** - Network or permissions issues
7. **Asset generation failures** - AI generation errors for missing categories

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
