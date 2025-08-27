// Creative Automation POC - Main Processing Script
// HYBRID APPROACH: Optimized parallel processing with selective sequencing
// - Firefly APIs: Parallel (they handle concurrency well)
// - Photoshop API: Sequential (to avoid rate limits)
// - Text Overlay: Parallel (local processing)
// - Best of both worlds: Speed + Reliability

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
    case '1:1': return { width: 2048, height: 2048 };
    case '9:16': return { width: 1792, height: 2304 };
    case '16:9': return { width: 2688, height: 1512 };
    default: return { width: 2048, height: 2048 };
  }
};

// PARALLELIZED: Generate missing assets with Promise.all (Firefly handles this well)
async function generateMissingAssetsParallel(firefly, s3Client, brief, missingCategories) {
  logger.info("generateMissingAssets: Starting parallel asset generation", { missingCategories });
  
  const generatedAssets = [];
  
  if (missingCategories.length === 0) {
    logger.info("generateMissingAssets: No missing categories, skipping generation");
    return generatedAssets;
  }
  
  // Create all generation tasks in parallel
  const generationTasks = [];
  
  for (const categoryName of missingCategories) {
    const categoryConfig = brief.product_categories[categoryName];
    if (!categoryConfig) {
      logger.warn("generateMissingAssets: Skipping unknown category", { category: categoryName });
      continue;
    }
    
    logger.info("generateMissingAssets: Generating images for missing category", { category: categoryName });
    
    // Generate all aspect ratios for this category in parallel
    for (const ratio of brief.aspect_ratios) {
      const { width, height } = ratioToSize(ratio);
      const enhancedPrompt = getEnhancedProductPrompt(categoryName, categoryConfig, ratio, brief);
      
      const task = generateSingleAsset(firefly, enhancedPrompt, width, height, categoryName, ratio);
      generationTasks.push(task);
    }
  }
  
  // Execute all generation tasks in parallel
  try {
    const results = await Promise.allSettled(generationTasks);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        generatedAssets.push(result.value);
        logger.info("generateMissingAssets: Generated asset ready for processing", result.value);
      } else {
        logger.error("generateMissingAssets: Failed to generate asset", { 
          error: result.reason?.message || 'Unknown error',
          taskIndex: index
        });
      }
    });
    
  } catch (error) {
    logger.error("generateMissingAssets: Parallel generation failed", error);
    throw error;
  }
  
  logger.info("generateMissingAssets: Parallel asset generation completed", { 
    generated: generatedAssets.length,
    total: generationTasks.length
  });
  
  return generatedAssets;
}

// Helper function for single asset generation
async function generateSingleAsset(firefly, enhancedPrompt, width, height, categoryName, ratio) {
  try {
    const generateResult = await generateImage(firefly, enhancedPrompt, width, height, 1, 'en-US');
    const generatedImageUrl = generateResult.outputs[0].image.url;
    
    const aspectRatioFormatted = ratio.replace(':', 'x');
    const filename = `${categoryName}_generated_${aspectRatioFormatted}.jpg`;
    
    return {
      category: categoryName,
      aspectRatio: ratio,
      downloadUrl: generatedImageUrl,
      filename: filename,
      prompt: enhancedPrompt,
      isGenerated: true,
      dimensions: { width, height }
    };
  } catch (error) {
    logger.error("generateSingleAsset: Failed", { 
      category: categoryName,
      aspectRatio: ratio, 
      error: error.message 
    });
    throw error;
  }
}

// HYBRID: Process assets with selective parallelization
async function processAssetsHybrid(assetReferences, brief, firefly, photoshop, s3Client) {
  logger.info("Starting HYBRID asset processing", { totalAssets: assetReferences.length });
  
  // Phase 1: Parallel Upload & Expand (Firefly handles this well)
  logger.info("Phase 1: Parallel Upload & Expand operations");
  const preparedAssets = await parallelUploadAndExpand(assetReferences, brief, firefly);
  
  // Phase 2: Sequential Mask Creation (Photoshop rate limit bottleneck)
  logger.info("Phase 2: Sequential Mask creation (avoiding rate limits)");
  const maskedAssets = await sequentialMaskCreation(preparedAssets, photoshop, s3Client);
  
  // Phase 3: Parallel Fill & Text Overlay (Fast operations)
  logger.info("Phase 3: Parallel Fill & Text overlay");
  const results = await parallelFillAndOverlay(maskedAssets, brief, firefly, s3Client);
  
  return results;
}

// Phase 1: Parallel Upload & Expand
async function parallelUploadAndExpand(assetReferences, brief, firefly) {
  const uploadExpandTasks = [];
  
  for (const assetRef of assetReferences) {
    const productCategoryConfig = brief.product_categories[assetRef.category];
    if (!productCategoryConfig) continue;
    
    // Load asset buffer once (for local assets)
    let baseBuffer;
    let assetName;
    
    try {
      if (assetRef.type === 'local') {
        if (!fs.existsSync(assetRef.path)) {
          throw new Error("Local image file not found");
        }
        baseBuffer = fs.readFileSync(assetRef.path);
        assetName = path.basename(assetRef.path);
      } else if (assetRef.type === 'generated') {
        assetName = assetRef.filename;
        baseBuffer = Buffer.alloc(0);
      }
      
      if (assetRef.type === 'local' && baseBuffer.length === 0) {
        throw new Error("Empty image buffer");
      }
    } catch (error) {
      logger.error(`Failed to load asset: ${assetRef.filename}`, error);
      continue;
    }
    
    // Create tasks for all region/ratio combinations
    for (const region of productCategoryConfig.target_regions) {
      for (const ratio of brief.aspect_ratios) {
        // Skip if generated asset doesn't match ratio
        if (assetRef.isGenerated && assetRef.aspectRatio !== ratio) {
          continue;
        }
        
        if (assetRef.isGenerated) {
          // Generated assets skip upload/expand
          uploadExpandTasks.push(Promise.resolve({
            assetRef,
            region,
            ratio,
            assetName,
            imageUrl: assetRef.downloadUrl,
            needsMask: false
          }));
        } else {
          // Local assets need upload/expand
          const task = uploadAndExpandSingle(assetRef, region, ratio, baseBuffer, assetName, firefly);
          uploadExpandTasks.push(task);
        }
      }
    }
  }
  
  // Execute all upload/expand operations in parallel
  logger.info(`Executing ${uploadExpandTasks.length} upload/expand operations in parallel`);
  const results = await Promise.allSettled(uploadExpandTasks);
  
  const preparedAssets = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      preparedAssets.push(result.value);
    } else {
      logger.error("Upload/Expand failed", { 
        error: result.reason?.message || 'Unknown error',
        taskIndex: index
      });
    }
  });
  
  logger.info(`Phase 1 completed: ${preparedAssets.length} assets prepared`);
  return preparedAssets;
}

// Single upload & expand operation
async function uploadAndExpandSingle(assetRef, region, ratio, baseBuffer, assetName, firefly) {
  try {
    const { width, height } = ratioToSize(ratio);
    const label = `${path.basename(assetName, path.extname(assetName))}_${region.code}_${ratio.replace(':', 'x')}`;
    
    logger.info("Upload & Expand", { label, targetSize: `${width}x${height}` });
    
    // Upload to Firefly
    const uploadResponse = await uploadImage(firefly, baseBuffer, assetName);
    const uploadResult = uploadResponse.data || uploadResponse.result || uploadResponse;
    const imageId = uploadResult.images[0].id;
    
    // Expand image
    const expandedImages = await expandImage(firefly, imageId, width, height, 1);
    const expandedImageUrl = expandedImages.expandResults.outputs[0].image.url;
    
    return {
      assetRef,
      region,
      ratio,
      assetName,
      imageUrl: expandedImageUrl,
      needsMask: true,
      label
    };
    
  } catch (error) {
    logger.error("Upload/Expand failed", { 
      asset: assetName,
      region: region.code,
      ratio,
      error: error.message 
    });
    throw error;
  }
}

// Phase 2: Sequential Mask Creation (THE BOTTLENECK)
async function sequentialMaskCreation(preparedAssets, photoshop, s3Client) {
  logger.info(`Phase 2: Processing ${preparedAssets.length} assets sequentially for masks`);
  
  const maskedAssets = [];
  
  for (let i = 0; i < preparedAssets.length; i++) {
    const asset = preparedAssets[i];
    
    logger.info(`Mask creation ${i + 1}/${preparedAssets.length}`, { 
      label: asset.label || `${asset.assetName}_${asset.region.code}_${asset.ratio}`
    });
    
    try {
      if (asset.needsMask) {
        // Create mask using Photoshop API (sequential)
        const invertMaskPresignedGetUrl = await createMask(
          s3Client, 
          photoshop, 
          asset.imageUrl, 
          asset.assetName, 
          S3_BUCKET_NAME, 
          S3_KEY_PREFIX + "/intermediate"
        );
        
        maskedAssets.push({
          ...asset,
          maskUrl: invertMaskPresignedGetUrl
        });
      } else {
        // Generated assets don't need masks
        maskedAssets.push({
          ...asset,
          maskUrl: null
        });
      }
      
      // Small delay between Photoshop API calls for stability
      if (asset.needsMask && i < preparedAssets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
    } catch (error) {
      logger.error("Mask creation failed", { 
        asset: asset.assetName,
        error: error.message 
      });
      // Continue with other assets
    }
  }
  
  logger.info(`Phase 2 completed: ${maskedAssets.length} assets with masks`);
  return maskedAssets;
}

// Phase 3: Parallel Fill & Text Overlay
async function parallelFillAndOverlay(maskedAssets, brief, firefly, s3Client) {
  logger.info(`Phase 3: Processing ${maskedAssets.length} assets in parallel for fill & overlay`);
  
  const finalTasks = maskedAssets.map(asset => 
    processFillAndOverlay(asset, brief, firefly, s3Client)
  );
  
  // Execute all fill & overlay operations in parallel
  const results = await Promise.allSettled(finalTasks);
  
  // Process results
  const processResults = {
    success: [],
    failures: [],
    summary: {
      total: maskedAssets.length,
      processed: results.length,
      succeeded: 0,
      failed: 0
    }
  };
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      processResults.success.push(result.value.data);
      processResults.summary.succeeded++;
    } else {
      processResults.failures.push(result.value?.error || { error: result.reason?.message });
      processResults.summary.failed++;
    }
  });
  
  logger.info(`Phase 3 completed: ${processResults.summary.succeeded} success, ${processResults.summary.failed} failed`);
  return processResults;
}

// Single fill & overlay operation
async function processFillAndOverlay(asset, brief, firefly, s3Client) {
  try {
    const { width, height } = ratioToSize(asset.ratio);
    const label = asset.label || `${path.basename(asset.assetName, path.extname(asset.assetName))}_${asset.region.code}_${asset.ratio.replace(':', 'x')}`;
    
    let imageUrl = asset.imageUrl;
    
    // Fill background if needed (local assets only)
    if (asset.needsMask && asset.maskUrl) {
      const fillImageResults = await fillImage(
        firefly, 
        asset.imageUrl, 
        asset.maskUrl, 
        asset.region.background_prompt, 
        1, 
        asset.region.locale
      );
      imageUrl = fillImageResults.outputs[0].image.url;
    }
    
    // Final processing & text overlay
    const baseFileName = path.basename(asset.assetName, path.extname(asset.assetName));
    const baseImageExtension = path.extname(asset.assetName);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const aspectRatioFormatted = asset.ratio.replace(':', 'x');
    const s3Key = `${S3_KEY_PREFIX}/${brief.id}/${asset.assetRef.category}/${asset.region.code}/${aspectRatioFormatted}/${baseFileName}_${asset.region.code}_${aspectRatioFormatted}_${timestamp}${baseImageExtension}`;
    const textLayerPutUrl = await s3Client.getPresignedPutUrl(S3_BUCKET_NAME, s3Key, 3600);
    
    const imageFormat = getMimeType(baseImageExtension);
    await addTextOverlay(imageUrl, textLayerPutUrl, asset.region.message, imageFormat, baseImageExtension);
    
    const finalImageGetUrl = await s3Client.getPresignedGetUrl(S3_BUCKET_NAME, s3Key, 3600);
    
    return {
      success: true,
      data: {
        assetName: asset.assetName,
        productCategory: asset.assetRef.category,
        region: asset.region.code,
        aspectRatio: asset.ratio,
        label,
        s3Key,
        presignedGetUrl: finalImageGetUrl,
        dimensions: { width, height },
        message: asset.region.message,
        assetType: asset.assetRef.type,
        isGenerated: asset.assetRef.isGenerated,
        processingSteps: asset.assetRef.isGenerated ? ['text_overlay'] : ['upload', 'expand', 'mask', 'fill', 'text_overlay'],
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    logger.error(`Fill & overlay failed`, { error: error.message });
    return {
      success: false,
      error: {
        assetName: asset.assetName,
        productCategory: asset.assetRef.category,
        region: asset.region.code,
        aspectRatio: asset.ratio,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Helper functions (unchanged from original)
function getBaseProductPrompt(category, brief) {
  const prompts = brief.product_prompts || {};
  return prompts[category] || `A premium ${category} product, modern design, clean style on white background, studio lighting, product photography style, high quality, commercial photography`;
}

function getEnhancedProductPrompt(category, categoryConfig, aspectRatio, brief) {
  const basePrompt = getBaseProductPrompt(category, brief);
  const backgroundPrompt = categoryConfig.target_regions[0]?.background_prompt || '';
  const enhancedPrompt = `${basePrompt}, set in ${backgroundPrompt}, professional commercial photography, high quality, detailed`;
  return enhancedPrompt;
}

async function getAssetReferences(assetsFolder, firefly, s3Client, brief) {
  const assetReferences = [];
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

  // Scan for existing local assets
  if (fs.existsSync(assetsFolder)) {
    function scanDirectory(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          scanDirectory(fullPath);
        } else if (item.isFile()) {
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

  // Generate missing assets in parallel
  if (missingCategories.length > 0) {
    logger.info("Missing categories detected, generating assets in parallel", { 
      missingCategories,
      totalCategories: Object.keys(brief.product_categories).length
    });
    
    const generatedAssets = await generateMissingAssetsParallel(firefly, s3Client, brief, missingCategories);
    
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

async function downloadImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    return await response.arrayBuffer();
  } catch (error) {
    console.error(`Error downloading image from ${imageUrl}:`, error.message);
    throw error;
  }
}

const readYaml = (p) => YAML.parse(fs.readFileSync(p, 'utf-8'));

async function main() {
  const startTime = Date.now();
  const brief = readYaml('./campaign.yaml').campaign;
  const assetsFolder = brief.assets_folder;

  logger.info("🚀 HYBRID Processing: Parallel + Sequential optimization");

  // Initialize Adobe authentication
  const authProvider = new ServerToServerTokenProvider({
    clientId: ADOBE_CLIENT_ID,
    clientSecret: ADOBE_CLIENT_SECRET,
    scopes: ADOBE_SCOPES
  }, {
    autoRefresh: true
  });

  const config = {
    tokenProvider: authProvider,
    clientId: ADOBE_CLIENT_ID
  };
  const photoshop = new PhotoshopClient(config);
  const firefly = new FireflyClient(config);
  const s3Client = new S3Client(AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);

  // Get all asset references
  const assetReferences = await getAssetReferences(assetsFolder, firefly, s3Client, brief);
  logger.info(`Found ${assetReferences.length} asset reference(s)`);

  // Process all assets with hybrid approach
  const results = await processAssetsHybrid(assetReferences, brief, firefly, photoshop, s3Client);

  const endTime = Date.now();
  const executionTime = (endTime - startTime) / 1000;

  // Log final results
  logger.info("HYBRID Processing completed", {
    summary: results.summary,
    executionTime: `${executionTime}s`,
    successCount: results.success.length,
    failureCount: results.failures.length
  });

  // Write results to file
  const now = new Date();
  const timestamp = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') + '-' +
    String(now.getMinutes()).padStart(2, '0') + '-' +
    String(now.getSeconds()).padStart(2, '0');
  const resultsFile = `./results-hybrid-${timestamp}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  logger.info("Results saved to file", { resultsFile, executionTime: `${executionTime}s` });

  return results;
}

main().catch((e) => {
  logger.error("Script execution failed", e);
  process.exit(1);
});
