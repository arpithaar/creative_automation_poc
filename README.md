# Creative Automation POC

## Overview
Proof of concept for automated creative asset localization using Adobe Firefly APIs and AWS S3. This project demonstrates automated image generation, background replacement, and text overlay capabilities for multi-regional marketing campaigns.

## Features

### 🤖 **Automated Image Processing**
- **Asset Generation**: AI-powered creation of missing product images using Firefly
- **Hybrid Processing**: Optimized parallel processing with selective sequencing for speed + reliability
- **Multi-Aspect Ratio Support**: Generate assets in 1:1 (square), 9:16 (portrait), and 16:9 (landscape) formats
- **Firefly-Optimized Dimensions**: Uses Adobe Firefly supported sizes (2048×2048, 1792×2304, 2688×1512)
- **Smart Concurrency**: Parallel operations where safe, sequential for rate-limited APIs
- **Background Replacement**: AI-powered background generation with region-specific prompts
- **Text Overlay**: Dynamic text placement with Sharp library
- **Multi-Format Support**: PNG, JPEG, WebP

### 🌍 **Multi-Regional Localization**
- **Region-Specific Content**: Different messages and backgrounds per region
- **Product Category Support**: Fragrances, shoes, clothing, accessories, etc.
- **Campaign Management**: YAML-based configuration system with product prompts
- **Intelligent Asset Management**: Automatic generation for missing product categories

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
ADOBE_SCOPES=openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your_bucket_name
S3_KEY_PREFIX={ldap}/creative_automation_poc
```

### Campaign Configuration
Edit `campaign.yaml`:
```yaml
campaign:
  name: "Bold Steps, Signature Scents 2025"
  id: "bold_steps_signature_scents_2025"
  assets_folder: "./assets/products"
  product_categories:
    fragrances:
      target_regions:
        - code: "US"
          locale: "en-US"
          audience: "luxury fragrance enthusiasts"
          message: "Captivate Your Essence"
          background_prompt: "elegant modern perfumery with soft lighting and marble surfaces"
        - code: "DE"
          locale: "de-DE"
          audience: "sophisticated scent connoisseurs"
          message: "Entdecke Deine Einzigartigkeit"
          background_prompt: "luxurious European boutique with refined decor and premium displays"
        - code: "ES"
          locale: "es-ES"
          audience: "passionate fragrance lovers"
          message: "Despierta Tus Sentidos"
          background_prompt: "elegant Spanish perfumery with warm lighting and artisanal details"
    shoes:
      target_regions:
        - code: "US"
          locale: "en-US"
          audience: "active lifestyle enthusiasts"
          message: "Step Into Your Power"
          background_prompt: "urban street basketball court with vibrant city skyline"
        - code: "DE"
          locale: "de-DE"
          audience: "fashion-forward athletes"
          message: "Mutige Schritte, Starker Look"
          background_prompt: "modern European city square with cobblestone streets and stylish architecture"
        - code: "ES"
          locale: "es-ES"
          audience: "passionate football fans"
          message: "Pasos Audaces, Looks Brillantes"
          background_prompt: "vibrant Spanish plaza with traditional architecture and street art"
  aspect_ratios:
    - "1:1"
    - "9:16"
    - "16:9"
  product_prompts:
    fragrances: "A luxury perfume bottle with elegant design, crystal clear glass, golden cap, sitting on a white marble surface with soft studio lighting, premium product photography style, high quality, commercial photography"
    shoes: "A premium athletic sneaker, modern design, clean white and accent colors, side view on white background, studio lighting, product photography style, high quality, commercial photography"
    clothing: "A premium fashion item, modern style, clean design on white background, studio lighting, product photography style, high quality, commercial photography"
    accessories: "A luxury accessory item, premium materials, elegant design on white background, studio lighting, product photography style, high quality, commercial photography"
```

### Run
```bash
npm start
```

**Note**: The main script now uses an optimized **hybrid approach** that combines parallel processing with selective sequencing for maximum speed and reliability.

## Project Structure
```
creative_automation_poc/
├── assets/
│   └── products/          # Source images by category
├── logs/                  # Application logs
├── results-hybrid-YYYY-MM-DD.json # Processing results
├── index.js              # Main application (hybrid approach)
├── firefly-utils.js       # Adobe API utilities
├── S3Client.js           # AWS S3 integration
├── logger.js             # Logging system
├── cleanup-logs.js       # Log management utility
├── campaign.yaml         # Campaign configuration
├── README.md             # Project documentation
├── SETUP.md              # Setup instructions
├── RESULTS.md            # Results documentation
├── LOGGING.md            # Logging documentation
└── .env                  # Environment variables
```

## Output Structure
Generated assets are organized in S3:
```
s3://bucket/creative_automation_poc/
├── intermediate/                    # Generated assets (temporary)
│   └── category_generated_ratio.jpg
└── campaign_id/                    # Final processed assets
    └── product_category/
        └── region/
            └── aspect_ratio/
                └── filename_region_ratio_timestamp.ext
```

### Asset Types
- **Local Assets**: Existing images processed through full pipeline (expand → mask → fill → text overlay)
  - Processed for all configured aspect ratios
  - Can be any initial size or format
- **Generated Assets**: AI-created images for missing categories (text overlay only)
  - Generated at Firefly-optimized dimensions for each aspect ratio
  - Only processed for their specific aspect ratio to maintain quality
  - Skip expand/mask/fill pipeline for efficiency

## Architecture & Workflow

### System Design Overview - Hybrid Approach

> **Note**: If the Mermaid diagrams below don't render in your Markdown viewer, they will display properly on GitHub, GitLab, VS Code with Mermaid extensions, or other Mermaid-compatible viewers.

```mermaid
graph TB
    subgraph "Input Sources"
        A[Local Assets<br/>./assets/products] 
        B[Campaign Config<br/>campaign.yaml]
    end
    
    subgraph "Discovery & Generation"
        C[Scan Local Assets]
        D[Identify Missing Categories]
        E[Generate Missing Assets<br/>Adobe Firefly API (Parallel)]
    end
    
    subgraph "Phase 1: Upload & Expand"
        F1[Upload to Firefly (Parallel)]
        F2[Expand Images (Parallel)]
    end
    
    subgraph "Phase 2: Mask Creation"
        G1[Create Masks<br/>Adobe Photoshop API (Sequential)]
        G2[Avoid Rate Limits]
    end
    
    subgraph "Phase 3: Fill & Text Overlay"
        H1[Fill Background (Parallel)<br/>Adobe Firefly API]
        H2[Add Text Overlay (Parallel)<br/>Sharp Library]
        H3[Upload to S3 (Parallel)]
    end
    
    subgraph "Generated Asset Fast Track"
        I1[Skip to Text Overlay (Parallel)<br/>Sharp Library]
        I2[Upload to S3 (Parallel)]
    end
    
    subgraph "Output & Results"
        J[Generate Presigned URLs]
        K[Results Tracking<br/>JSON + Logs]
    end
    
    A --> C
    B --> C
    C --> D
    D --> E
    C --> F1
    
    F1 --> F2
    F2 --> G1
    G1 --> G2
    G2 --> H1
    H1 --> H2
    H2 --> H3
    
    E --> I1
    I1 --> I2
    
    H3 --> J
    I2 --> J
    J --> K
```

### API Integration Details - Hybrid Processing

```mermaid
sequenceDiagram
    participant App as Application
    participant FF as Adobe Firefly API
    participant PS as Adobe Photoshop API
    participant S3 as AWS S3 API
    participant Sharp as Sharp Library
    
    Note over App: Asset Discovery Phase
    App->>App: Scan local assets
    App->>App: Identify missing categories
    
    Note over App,FF: Generated Asset Creation (Parallel)
    par Generate All Aspect Ratios
        App->>FF: generateImages(1:1)
    and
        App->>FF: generateImages(9:16)
    and
        App->>FF: generateImages(16:9)
    end
    FF-->>App: All generated URLs
    
    Note over App: PHASE 1 - Upload & Expand (Parallel)
    par Multiple Assets in Parallel
        App->>FF: upload(asset1)
        App->>FF: upload(asset2)
        App->>FF: upload(assetN)
    end
    par Expand Operations in Parallel
        App->>FF: expandImage(asset1)
        App->>FF: expandImage(asset2)
        App->>FF: expandImage(assetN)
    end
    FF-->>App: All expanded URLs
    
    Note over App: PHASE 2 - Mask Creation (Sequential)
    loop For each asset sequentially
        App->>PS: createMask(expandedURL)
        PS-->>App: maskURL
        Note over App: Small delay to avoid rate limits
    end
    
    Note over App: PHASE 3 - Fill & Overlay (Parallel)
    par Fill Operations in Parallel
        App->>FF: fillImage(asset1, mask1)
        App->>FF: fillImage(asset2, mask2)
        App->>FF: fillImage(assetN, maskN)
    and Text Overlay in Parallel (Local Assets)
        App->>Sharp: addTextOverlay(local1)
        App->>Sharp: addTextOverlay(local2)
        App->>Sharp: addTextOverlay(localN)
    and Generated Asset Fast Track (Parallel)
        App->>Sharp: addTextOverlay(gen1)
        App->>Sharp: addTextOverlay(gen2)
        App->>Sharp: addTextOverlay(genN)
    end
    
    par Final Upload in Parallel (All Assets)
        App->>S3: putObject(localFinal1)
        App->>S3: putObject(localFinal2)
        App->>S3: putObject(genFinal1)
        App->>S3: putObject(genFinal2)
        App->>S3: putObject(allFinalN)
    end
    
    Note over App,S3: Results Generation
    App->>S3: getPresignedUrl(s3Key)
    S3-->>App: presignedUrl
    App->>App: Save results to hybrid JSON + logs
```

### Hybrid Approach Benefits

| Phase | Strategy | Benefit |
|-------|----------|---------|
| **Asset Generation** | Parallel | ~3x faster generation |
| **Upload & Expand** | Parallel | Maximum Firefly throughput |
| **Mask Creation** | Sequential | Zero rate limit errors |
| **Fill & Overlay** | Parallel | ~2x faster final processing |

**Result**: ~70-80% of full parallel speed with 100% reliability

### Text-Based Workflow Summary

**Phase 1: Asset Discovery**
1. Scan `./assets/products` for existing images
2. Parse `campaign.yaml` for configuration
3. Identify missing product categories
4. Generate missing assets via Adobe Firefly API *(parallel)*

**Phase 2: Hybrid Processing Pipeline**

*Phase 2A: Upload & Expand (Parallel)*
- **Upload** → Adobe Firefly API *(parallel)*
- **Expand** → Adobe Firefly API *(parallel)*

*Phase 2B: Mask Creation (Sequential)*  
- **Mask** → Adobe Photoshop API *(sequential to avoid rate limits)*

*Phase 2C: Fill & Text Overlay (Parallel)*
- **Fill** → Adobe Firefly API *(parallel)*
- **Text Overlay** → Sharp Library *(parallel)*
- **Upload** → AWS S3 *(parallel)*

*Generated Assets (Streamlined):*
1. **Text Overlay** → Sharp Library (add localized text)
2. **Upload** → AWS S3 (final storage)

**Phase 3: Results & Tracking**
1. Generate presigned URLs for easy access
2. Save detailed results to JSON file
3. Log all operations with timestamps
4. Track success/failure rates per region/ratio

## Key Technologies
- **Adobe Firefly API**: AI image generation and manipulation
- **Adobe Photoshop API**: Advanced image editing capabilities
- **Sharp**: High-performance image processing
- **AWS S3**: Cloud storage with presigned URLs
- **Node.js**: Runtime environment

## Documentation
- [📋 Logging System](./LOGGING.md)
- [📊 Results Tracking](./RESULTS.md)
- [⚙️ Setup Instructions](./SETUP.md)

## Utilities

### Log Management
```bash
# Check log status and show help
node cleanup-logs.js

# Clean old logs - keep last 2 days (recommended)
node cleanup-logs.js --auto

# Clean only rotated/timestamped files
node cleanup-logs.js --rotated

# Delete all log files (nuclear option)
node cleanup-logs.js --all
```

## Use Cases
- **Marketing Campaigns**: Automated asset localization
- **E-commerce**: Product image variations
- **Brand Management**: Consistent regional messaging
- **Content Creation**: Scalable creative workflows

## License
Proof of concept project for demonstration purposes.
