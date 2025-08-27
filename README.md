# Creative Automation POC

## Overview
Proof of concept for automated creative asset localization using Adobe Firefly APIs and AWS S3. This project demonstrates automated image generation, background replacement, and text overlay capabilities for multi-regional marketing campaigns.

## Features

### 🤖 **Automated Image Processing**
- **Image Expansion**: Resize assets to different aspect ratios
- **Background Replacement**: AI-powered background generation with region-specific prompts
- **Text Overlay**: Dynamic text placement with Sharp library
- **Multi-Format Support**: PNG, JPEG, WebP

### 🌍 **Multi-Regional Localization**
- **Region-Specific Content**: Different messages and backgrounds per region
- **Product Category Support**: Fragrances, shoes, makeup, jewelry, etc.
- **Campaign Management**: YAML-based configuration system

### 📊 **Results & Monitoring**
- **Success/Failure Tracking**: Detailed results for each processed image
- **Presigned URLs**: Direct access to generated assets
- **Comprehensive Logging**: File-based logs with rotation
- **JSON Reports**: Structured output for integration

### ☁️ **Cloud Integration**
- **AWS S3**: Automated storage with organized folder structure
- **Adobe Firefly**: AI image generation and manipulation
- **Adobe Photoshop**: Advanced masking and compositing

## Quick Start

### Prerequisites
- Node.js ≥ 20
- Adobe Firefly API credentials
- AWS S3 credentials

### Installation
```bash
npm install
```

### Configuration
Create `.env` file:
```bash
# Adobe Firefly API
ADOBE_CLIENT_ID=your_client_id
ADOBE_CLIENT_SECRET=your_client_secret
ADOBE_SCOPES=openid,AdobeID,firefly_api,ff_apis

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your_bucket_name
S3_KEY_PREFIX=creative_automation_poc
```

### Campaign Configuration
Edit `campaign.yaml`:
```yaml
campaign:
  id: "creative_automative_poc_2025"
  name: "Bold Steps, Signature Scents"
  assets_folder: "./assets/products"
  aspect_ratios: ["1:1", "16:9", "9:16"]
  
  product_categories:
    fragrances:
      target_regions:
        - code: "US"
          locale: "en-US"
          audience: "young professionals"
          message: "Captivate Your Essence"
          background_prompt: "elegant modern perfumery"
    shoes:
      target_regions:
        - code: "US"
          locale: "en-US"
          audience: "active lifestyle enthusiasts"
          message: "Step Into Confidence"
          background_prompt: "urban streetwear environment"
```

### Run
```bash
npm start
```

## Project Structure
```
creative_automative_poc/
├── assets/
│   └── products/          # Source images by category
├── logs/                  # Application logs
├── results-YYYY-MM-DD.json # Processing results
├── index.js              # Main application
├── firefly-utils.js       # Adobe API utilities
├── S3Client.js           # AWS S3 integration
├── logger.js             # Logging system
├── campaign.yaml         # Campaign configuration
└── .env                  # Environment variables
```

## Output Structure
Generated assets are organized in S3:
```
s3://bucket/creative_automation_poc/
└── campaign_id/
    └── product_category/
        └── region/
            └── aspect_ratio/
                └── filename_region_ratio_timestamp.ext
```

## Key Technologies
- **Adobe Firefly API**: AI image generation and manipulation
- **Adobe Photoshop API**: Advanced image editing capabilities
- **Sharp**: High-performance image processing
- **AWS S3**: Cloud storage with presigned URLs
- **Node.js**: Runtime environment

## Documentation
- [📋 Logging System](./LOGGING.md)
- [📊 Results Tracking](./RESULTS.md)

## Use Cases
- **Marketing Campaigns**: Automated asset localization
- **E-commerce**: Product image variations
- **Brand Management**: Consistent regional messaging
- **Content Creation**: Scalable creative workflows

## License
Proof of concept project for demonstration purposes.
