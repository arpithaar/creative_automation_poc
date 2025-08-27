
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';
import YAML from 'yaml';
import { PhotoshopClient } from "@adobe/photoshop-apis";
import { FireflyClient } from "@adobe/firefly-apis";
import { uploadImage, expandImage, createMask, fillImage, addTextOverlay, getMimeType } from './firefly-utils.js';
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
    case '1:1': return { width: 2048, height: 2048 };
    case '9:16': return { width: 1440, height: 2560 };
    case '16:9': return { width: 2560, height: 1440 };
    default: return { width: 2048, height: 2048 };
  }
};


// Helper function to recursively get all image files from a directory
function getImageFiles(assetsFolder) {
  if (!fs.existsSync(assetsFolder)) {
    throw new Error(`Assets folder not found: ${assetsFolder}`);
  }

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const imageFiles = [];

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
          imageFiles.push(fullPath);
        }
      }
    }
  }

  scanDirectory(assetsFolder);

  if (imageFiles.length === 0) {
    throw new Error(`No image files found in assets folder: ${assetsFolder}`);
  }

  return imageFiles;
}

// Helper function to download image from URL
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

  // Get all image files from the assets folder
  const imageFiles = getImageFiles(assetsFolder);
  logger.info(`Found ${imageFiles.length} image(s) in assets folder`, { files: imageFiles.map(f => path.basename(f)) });

  // Calculate total expected outputs
  let totalExpectedOutputs = 0;
  for (const baseImagePath of imageFiles) {
    const productCategory = path.basename(path.dirname(baseImagePath));
    const productCategoryConfig = brief.product_categories[productCategory];
    if (productCategoryConfig) {
      totalExpectedOutputs += productCategoryConfig.target_regions.length * brief.aspect_ratios.length;
    }
  }
  results.summary.total = totalExpectedOutputs;

  // Initialize Adobe authentication
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

  // Process each image file
  for (const baseImagePath of imageFiles) {
    logger.info("Starting image processing", { image: path.basename(baseImagePath) });

    // Validate image exists and is not empty
    if (!fs.existsSync(baseImagePath)) {
      logger.error(`Skipping - Image not found: ${baseImagePath}`);
      // Add to failures for missing files
      const productCategory = path.basename(path.dirname(baseImagePath));
      const productCategoryConfig = brief.product_categories[productCategory];
      if (productCategoryConfig) {
        for (const region of productCategoryConfig.target_regions) {
          for (const ratio of brief.aspect_ratios) {
            results.failures.push({
              assetName: path.basename(baseImagePath),
              productCategory,
              region: region.code,
              aspectRatio: ratio,
              error: "Image file not found",
              timestamp: new Date().toISOString()
            });
            results.summary.failed++;
          }
        }
      }
      continue;
    }

    const baseBuffer = fs.readFileSync(baseImagePath);

    if (baseBuffer.length === 0) {
      logger.error(`Skipping - Empty image: ${baseImagePath}`);
      // Add to failures for empty files
      const productCategory = path.basename(path.dirname(baseImagePath));
      const productCategoryConfig = brief.product_categories[productCategory];
      if (productCategoryConfig) {
        for (const region of productCategoryConfig.target_regions) {
          for (const ratio of brief.aspect_ratios) {
            results.failures.push({
              assetName: path.basename(baseImagePath),
              productCategory,
              region: region.code,
              aspectRatio: ratio,
              error: "Empty image file",
              timestamp: new Date().toISOString()
            });
            results.summary.failed++;
          }
        }
      }
      continue;
    }

    logger.info("Reading image", { filename: path.basename(baseImagePath), size: `${baseBuffer.length} bytes` });

    // Extract the product category from the folder structure (e.g., "fragrances" from "./assets/products/fragrances/Fragrance.jpg")
    const productCategory = path.basename(path.dirname(baseImagePath));

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
        const { width, height } = ratioToSize(ratio);
        const imageName = path.basename(baseImagePath, path.extname(baseImagePath));
        const label = `${imageName}_${region.code}_${ratio.replace(':', 'x')}`;

        results.summary.processed++;
        logger.info("Step 1: Expanding image", { label, targetSize: `${width}x${height}` });

        try {

          //Step 1: Upload the base image to Firefly
          const uploadResponse = await uploadImage(firefly, baseBuffer, path.basename(baseImagePath));
          // Extract the actual response data
          const uploadResult = uploadResponse.data || uploadResponse.result || uploadResponse;
          const imageId = uploadResult.images[0].id;
          logger.info("Upload completed", { imageId });

          //Step 2: Expand the image to the desired size
          const expandedImages = await expandImage(firefly, imageId, width, height, 1);
          const expandedImageUrl = expandedImages.expandResults.outputs[0].image.url;
          logger.info("Step 2: Image expanded", { label });

          //Step 3: Create a mask of the expanded image
          const invertMaskPresignedGetUrl = await createMask(s3Client, photoshop, expandedImageUrl, path.basename(baseImagePath), S3_BUCKET_NAME, S3_KEY_PREFIX + "/intermediate");
          logger.info("Step 3: Mask created and inverted", { label });

          //Step 4: Fill the image with the desired background
          const fillImageResults = await fillImage(firefly, expandedImageUrl, invertMaskPresignedGetUrl, region.background_prompt, 1, region.locale);
          const imageUrl = fillImageResults.outputs[0].image.url;
          logger.info("Step 4: Background filled", { label, prompt: region.background_prompt });

          // Extract the actual filename without extension for use in the final filename (e.g., "Fragrance")
          const baseFileName = path.basename(baseImagePath, path.extname(baseImagePath));
          // Extract the base image extension (e.g., ".jpg")
          const baseImageExtension = path.extname(baseImagePath);

          // Construct S3 key with organized folder structure
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const aspectRatioFormatted = ratio.replace(':', 'x');
          // Use the actual base image format
          const s3Key = `${S3_KEY_PREFIX}/${brief.id}/${productCategory}/${region.code}/${aspectRatioFormatted}/${baseFileName}_${region.code}_${aspectRatioFormatted}_${timestamp}${baseImageExtension}`;
          const textLayerPutUrl = await s3Client.getPresignedPutUrl(S3_BUCKET_NAME, s3Key, 3600);

          //Step 5: Add text overlay using Sharp
          logger.info("Step 5: Adding text overlay", {
            label,
            message: region.message,
            dimensions: `${width}x${height}`
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
            assetName: path.basename(baseImagePath),
            productCategory,
            region: region.code,
            aspectRatio: ratio,
            label,
            s3Key,
            presignedGetUrl: finalImageGetUrl,
            dimensions: { width, height },
            message: region.message,
            timestamp: new Date().toISOString()
          });
          results.summary.succeeded++;

        } catch (error) {
          // Record failure
          logger.error(`Failed to process ${label}`, error);
          results.failures.push({
            assetName: path.basename(baseImagePath),
            productCategory,
            region: region.code,
            aspectRatio: ratio,
            label,
            error: error.message || error.toString(),
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

  // Write results to file
  const resultsFile = `./results-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  logger.info("Results saved to file", { resultsFile });

  return results;
}

main().catch((e) => {
  logger.error("Script execution failed", e);
  process.exit(1);
});
