
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';
import YAML from 'yaml';
import { PhotoshopClient } from "@adobe/photoshop-apis";
import { FireflyClient } from "@adobe/firefly-apis";
import { uploadImage, expandImage, createMask, fillImage, addTextOverlay, getMimeType, generateImage } from './firefly-utils.js';
import { ServerToServerTokenProvider } from "@adobe/firefly-services-common-apis";
import S3Client from "./S3Client.js";
import logger from "./logger.js";

const {
  ADOBE_CLIENT_ID,
  ADOBE_CLIENT_SECRET,
  ADOBE_SCOPES,
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME,
  S3_KEY_PREFIX
} = process.env;

if (!ADOBE_CLIENT_ID || !ADOBE_CLIENT_SECRET || !ADOBE_SCOPES) {
  console.error('Missing required environment variables:');
  console.error('- ADOBE_CLIENT_ID');
  console.error('- ADOBE_CLIENT_SECRET');
  console.error('- ADOBE_SCOPES');
  process.exit(1);
}

// Check for S3 configuration
if (!AWS_REGION || !S3_BUCKET_NAME || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !S3_KEY_PREFIX) {
  console.error('Missing required S3 environment variables:');
  console.error('- AWS_REGION');
  console.error('- S3_BUCKET_NAME');
  console.error('- AWS_ACCESS_KEY_ID');
  console.error('- AWS_SECRET_ACCESS_KEY');
  console.error('- S3_KEY_PREFIX');
  process.exit(1);
}

const ratioToSize = (ratio) => {
  switch (ratio) {
    case '1:1': return { width: 2048, height: 2048 }; // Perfect 1:1 square
    case '9:16': return { width: 1792, height: 2304 }; // Portrait format (1792:2304 ≈ 9:16)
    case '16:9': return { width: 2688, height: 1512 }; // Perfect 16:9 landscape
    default: return { width: 2048, height: 2048 };
  }
};


// Helper function to generate missing assets using Firefly
async function generateMissingAssets(firefly, s3Client, brief, missingCategories) {
  logger.info("generateMissingAssets: Starting asset generation", { missingCategories });
  
  const generatedAssets = [];
  
  // Early return if no missing categories
  if (missingCategories.length === 0) {
    logger.info("generateMissingAssets: No missing categories, skipping generation");
    return generatedAssets;
  }
  
  // Generate assets only for missing categories
  for (const categoryName of missingCategories) {
    const categoryConfig = brief.product_categories[categoryName];
    if (!categoryConfig) {
      logger.warn("generateMissingAssets: Skipping unknown category", { category: categoryName });
      continue;
    }
    
    logger.info("generateMissingAssets: Generating images for missing category", { category: categoryName });
    
    // Generate for each aspect ratio directly
    for (const ratio of brief.aspect_ratios) {
      const { width, height } = ratioToSize(ratio);
      
      // Create enhanced prompt that includes background for the category and regions
      const enhancedPrompt = getEnhancedProductPrompt(categoryName, categoryConfig, ratio, brief);
      
      try {
        const generateResult = await generateImage(firefly, enhancedPrompt, width, height, 1, 'en-US');
        const generatedImageUrl = generateResult.outputs[0].image.url;
        
        // Use generated image URL directly, no intermediate S3 storage needed
        const aspectRatioFormatted = ratio.replace(':', 'x');
        const filename = `${categoryName}_generated_${aspectRatioFormatted}.jpg`;
        
        generatedAssets.push({
          category: categoryName,
          aspectRatio: ratio,
          downloadUrl: generatedImageUrl,
          filename: filename,
          prompt: enhancedPrompt,
          isGenerated: true,
          dimensions: { width, height }
        });
        
        logger.info("generateMissingAssets: Generated asset ready for processing", { 
          category: categoryName,
          aspectRatio: ratio,
          filename: filename,
          imageUrl: generatedImageUrl.substring(0, 100) + "..."
        });
        
      } catch (error) {
        logger.error("generateMissingAssets: Failed to generate asset", { 
          category: categoryName,
          aspectRatio: ratio, 
          error: error.message 
        });
        throw error;
      }
    }
  }
  
  logger.info("generateMissingAssets: Asset generation completed", { 
    generated: generatedAssets.length,
    assets: generatedAssets
  });
  
  return generatedAssets;
}

// Helper function to create base product prompts
function getBaseProductPrompt(category, brief) {
  const prompts = brief.product_prompts || {};
  
  return prompts[category] || `A premium ${category} product, modern design, clean style on white background, studio lighting, product photography style, high quality, commercial photography`;
}

// Helper function to create enhanced prompts with background for generated assets
function getEnhancedProductPrompt(category, categoryConfig, aspectRatio, brief) {
  const basePrompt = getBaseProductPrompt(category, brief);
  
  // Get a representative background prompt from the first region
  const backgroundPrompt = categoryConfig.target_regions[0]?.background_prompt || '';
  
  // Combine product and background for a complete scene
  const enhancedPrompt = `${basePrompt}, set in ${backgroundPrompt}, professional commercial photography, high quality, detailed`;
  
  return enhancedPrompt;
}

// Helper function to get asset references (local files + S3 generated assets)
async function getAssetReferences(assetsFolder, firefly, s3Client, brief) {
  const assetReferences = [];
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

  // First, scan for existing local assets
  if (fs.existsSync(assetsFolder)) {
    function scanDirectory(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(fullPath);
        } else if (item.isFile()) {
          // Check if it's an image file
          const ext = path.extname(item.name).toLowerCase();
          if (imageExtensions.includes(ext)) {
            const productCategory = path.basename(path.dirname(fullPath));
            assetReferences.push({
              type: 'local',
              path: fullPath,
              category: productCategory,
              filename: path.basename(fullPath),
              isGenerated: false
            });
          }
        }
      }
    }

    scanDirectory(assetsFolder);
    logger.info(`Found ${assetReferences.length} local asset(s)`, { 
      files: assetReferences.map(a => a.filename) 
    });
  }

  // Check which product categories are missing assets
  const categoriesWithAssets = new Set(assetReferences.map(a => a.category));
  const missingCategories = Object.keys(brief.product_categories).filter(
    category => !categoriesWithAssets.has(category)
  );

  // Generate missing assets for categories without local assets
  if (missingCategories.length > 0) {
    logger.info("Missing categories detected, generating assets", { 
      missingCategories,
      totalCategories: Object.keys(brief.product_categories).length
    });
    
    const generatedAssets = await generateMissingAssets(firefly, s3Client, brief, missingCategories);
    
    // Add generated assets to references, but only for missing categories
    for (const generatedAsset of generatedAssets) {
      if (missingCategories.includes(generatedAsset.category)) {
        assetReferences.push({
          type: 'generated',
          downloadUrl: generatedAsset.downloadUrl,
          category: generatedAsset.category,
          filename: generatedAsset.filename,
          aspectRatio: generatedAsset.aspectRatio,
          dimensions: generatedAsset.dimensions,
          isGenerated: true
        });
      }
    }
  }

  if (assetReferences.length === 0) {
    throw new Error(`No assets found or generated for any product categories`);
  }

  logger.info(`Total asset references: ${assetReferences.length}`, {
    local: assetReferences.filter(a => a.type === 'local').length,
    generated: assetReferences.filter(a => a.type === 'generated').length,
    categories: [...new Set(assetReferences.map(a => a.category))]
  });

  return assetReferences;
}

const readYaml = (p) => YAML.parse(fs.readFileSync(p, 'utf-8'));


async function main() {
  const brief = readYaml('./campaign.yaml').campaign;
  const assetsFolder = brief.assets_folder;

  // Initialize results tracking
  const results = {
    success: [],
    failures: [],
    summary: {
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0
    }
  };

  // Initialize Adobe authentication first (needed for asset generation)
  const authProvider = new ServerToServerTokenProvider({
    clientId: ADOBE_CLIENT_ID,
    clientSecret: ADOBE_CLIENT_SECRET,
    scopes: ADOBE_SCOPES
  },
    {
      autoRefresh: true
    });

  const config = {
    tokenProvider: authProvider,
    clientId: ADOBE_CLIENT_ID
  };
  const photoshop = new PhotoshopClient(config);
  const firefly = new FireflyClient(config);
  const s3Client = new S3Client(AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);

  // Get all asset references (local files + S3 generated assets)
  const assetReferences = await getAssetReferences(assetsFolder, firefly, s3Client, brief);
  logger.info(`Found ${assetReferences.length} asset reference(s)`, { 
    assets: assetReferences.map(a => ({ filename: a.filename, type: a.type, category: a.category }))
  });

  // Calculate total expected outputs
  let totalExpectedOutputs = 0;
  for (const assetRef of assetReferences) {
    const productCategoryConfig = brief.product_categories[assetRef.category];
    if (productCategoryConfig) {
      totalExpectedOutputs += productCategoryConfig.target_regions.length * brief.aspect_ratios.length;
    }
  }
  results.summary.total = totalExpectedOutputs;

  // Process each asset reference
  for (const assetRef of assetReferences) {
    logger.info("Starting image processing", { 
      asset: assetRef.filename, 
      type: assetRef.type, 
      category: assetRef.category,
      isGenerated: assetRef.isGenerated
    });

    // Get image buffer based on asset type
    let baseBuffer;
    let assetName;

    try {
      if (assetRef.type === 'local') {
        // Handle local files
        if (!fs.existsSync(assetRef.path)) {
          throw new Error("Local image file not found");
        }
        baseBuffer = fs.readFileSync(assetRef.path);
        assetName = path.basename(assetRef.path);
      } else if (assetRef.type === 'generated') {
        // Handle generated assets (no need to download, will use URL directly)
        assetName = assetRef.filename;
        baseBuffer = Buffer.alloc(0); // Empty buffer since we won't use it for generated assets
      }

      if (assetRef.type === 'local' && baseBuffer.length === 0) {
        throw new Error("Empty image buffer");
      }

      logger.info("Image loaded", { 
        filename: assetName, 
        size: `${baseBuffer.length} bytes`,
        type: assetRef.type,
        isGenerated: assetRef.isGenerated
      });

    } catch (error) {
      logger.error(`Skipping - Failed to load asset: ${assetRef.filename}`, error);
      // Add to failures for loading errors
      const productCategoryConfig = brief.product_categories[assetRef.category];
      if (productCategoryConfig) {
        for (const region of productCategoryConfig.target_regions) {
          for (const ratio of brief.aspect_ratios) {
            results.failures.push({
              assetName: assetRef.filename,
              productCategory: assetRef.category,
              region: region.code,
              aspectRatio: ratio,
              error: `Failed to load asset: ${error.message}`,
              timestamp: new Date().toISOString()
            });
            results.summary.failed++;
          }
        }
      }
      continue;
    }

    // Use the category from asset reference
    const productCategory = assetRef.category;

    // Get the product category's target regions
    const productCategoryConfig = brief.product_categories[productCategory];

    if (!productCategoryConfig) {
      logger.error(`No configuration found for product category: ${productCategory}`, {
        availableCategories: Object.keys(brief.product_categories)
      });
      continue;
    }

    for (const region of productCategoryConfig.target_regions) {
      for (const ratio of brief.aspect_ratios) {
        // Skip processing if this is a generated asset and it doesn't match the current ratio
        if (assetRef.isGenerated && assetRef.aspectRatio !== ratio) {
          continue;
        }

        const { width, height } = ratioToSize(ratio);
        const imageName = path.basename(assetName, path.extname(assetName));
        const label = `${imageName}_${region.code}_${ratio.replace(':', 'x')}`;

        results.summary.processed++;

        try {
          let imageUrl;

          if (assetRef.isGenerated) {
            // For generated assets: Skip expand/mask/fill, use the generated image directly
            logger.info("Processing generated asset - skipping expand/mask/fill", { 
              label, 
              targetSize: `${width}x${height}`,
              sourceSize: `${assetRef.dimensions.width}x${assetRef.dimensions.height}`
            });
            imageUrl = assetRef.downloadUrl;
          } else {
            // For local assets: Use full processing pipeline
            logger.info("Step 1: Expanding image", { label, targetSize: `${width}x${height}` });

            //Step 1: Upload the base image to Firefly
            const uploadResponse = await uploadImage(firefly, baseBuffer, assetName);
            // Extract the actual response data
            const uploadResult = uploadResponse.data || uploadResponse.result || uploadResponse;
            const imageId = uploadResult.images[0].id;
            logger.info("Upload completed", { imageId });

            //Step 2: Expand the image to the desired size
            const expandedImages = await expandImage(firefly, imageId, width, height, 1);
            const expandedImageUrl = expandedImages.expandResults.outputs[0].image.url;
            logger.info("Step 2: Image expanded", { label });

            //Step 3: Create a mask of the expanded image
            const invertMaskPresignedGetUrl = await createMask(s3Client, photoshop, expandedImageUrl, assetName, S3_BUCKET_NAME, S3_KEY_PREFIX + "/intermediate");
            logger.info("Step 3: Mask created and inverted", { label });

            //Step 4: Fill the image with the desired background
            const fillImageResults = await fillImage(firefly, expandedImageUrl, invertMaskPresignedGetUrl, region.background_prompt, 1, region.locale);
            imageUrl = fillImageResults.outputs[0].image.url;
            logger.info("Step 4: Background filled", { label, prompt: region.background_prompt });
          }

          // Extract the actual filename without extension for use in the final filename (e.g., "Fragrance")
          const baseFileName = path.basename(assetName, path.extname(assetName));
          // Extract the base image extension (e.g., ".jpg")
          const baseImageExtension = path.extname(assetName);

          // Construct S3 key with organized folder structure
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const aspectRatioFormatted = ratio.replace(':', 'x');
          // Use the actual base image format
          const s3Key = `${S3_KEY_PREFIX}/${brief.id}/${productCategory}/${region.code}/${aspectRatioFormatted}/${baseFileName}_${region.code}_${aspectRatioFormatted}_${timestamp}${baseImageExtension}`;
          const textLayerPutUrl = await s3Client.getPresignedPutUrl(S3_BUCKET_NAME, s3Key, 3600);

          //Final Step: Add text overlay using Sharp
          logger.info("Adding text overlay", {
            label,
            message: region.message,
            dimensions: `${width}x${height}`,
            isGenerated: assetRef.isGenerated
          });

          const imageFormat = getMimeType(baseImageExtension); // Use actual base image format
          const textOverlayResponse = await addTextOverlay(imageUrl, textLayerPutUrl, region.message, imageFormat, baseImageExtension);
          logger.info("Text overlay completed", {
            label,
            status: textOverlayResponse.status,
            outputSize: textOverlayResponse.fontSize,
            s3Key
          });

          // Generate presigned GET URL for the final result
          const finalImageGetUrl = await s3Client.getPresignedGetUrl(S3_BUCKET_NAME, s3Key, 3600);

          // Record success
          results.success.push({
            assetName: assetName,
            productCategory,
            region: region.code,
            aspectRatio: ratio,
            label,
            s3Key,
            presignedGetUrl: finalImageGetUrl,
            dimensions: { width, height },
            message: region.message,
            assetType: assetRef.type,
            isGenerated: assetRef.isGenerated,
            processingSteps: assetRef.isGenerated ? ['text_overlay'] : ['upload', 'expand', 'mask', 'fill', 'text_overlay'],
            timestamp: new Date().toISOString()
          });
          results.summary.succeeded++;

        } catch (error) {
          // Record failure
          logger.error(`Failed to process ${label}`, error);
          results.failures.push({
            assetName: assetName,
            productCategory,
            region: region.code,
            aspectRatio: ratio,
            label,
            error: error.message || error.toString(),
            assetType: assetRef.type,
            isGenerated: assetRef.isGenerated,
            timestamp: new Date().toISOString()
          });
          results.summary.failed++;
        }
      }
    }
  }

  // Log final results
  logger.info("Processing completed", {
    summary: results.summary,
    successCount: results.success.length,
    failureCount: results.failures.length
  });

  // Log detailed results
  if (results.success.length > 0) {
    logger.info("Successful outputs", {
      count: results.success.length,
      results: results.success
    });
  }

  if (results.failures.length > 0) {
    logger.error("Failed outputs", {
      count: results.failures.length,
      failures: results.failures
    });
  }

  // Write results to file with full timestamp
  const now = new Date();
  const timestamp = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') + '-' +
    String(now.getMinutes()).padStart(2, '0') + '-' +
    String(now.getSeconds()).padStart(2, '0');
  const resultsFile = `./results-${timestamp}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  logger.info("Results saved to file", { resultsFile });

  return results;
}

main().catch((e) => {
  logger.error("Script execution failed", e);
  process.exit(1);
});
