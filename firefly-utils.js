import { v4 as uuidv4 } from 'uuid';
import { StorageType, ImageFormatType } from "@adobe/photoshop-apis";
import path from 'node:path';
import sharp from 'sharp';
import fetch from 'node-fetch';
import logger from './logger.js';

async function uploadImage(firefly, imageBuffer, filename) {
  try {
    logger.info("uploadImage: Starting upload", { filename, size: `${imageBuffer.length} bytes` });
    
    // Determine MIME type from file extension
    
    const mimeType = getMimeType(filename);
    logger.debug("Using MIME type", { filename, mimeType });
    
    const uploadResult = await firefly.upload(new Blob([imageBuffer], { type: mimeType }));
    logger.info("uploadImage: Upload completed", { filename });
    
    return uploadResult;
  } catch (error) {
    logger.error("uploadImage failed", error);
    throw error;
  }
}

async function expandImage (firefly, imageId, expandedWidth, expandedHeight, numVariations) {
  try {
    console.log(`expandImage: Starting gen expand image to: ${expandedWidth}x${expandedHeight}`);

    const ffInput = {
      image: {
        source: {
          uploadId: imageId  
        }
      },
      numVariations: numVariations,
      size: {
        width: expandedWidth,
        height: expandedHeight
      }
    };

    const expandResults = await firefly.expandImage(ffInput);
    console.log(`expandImage: gen expand completed`);

    return {
      expandResults: expandResults.result
    };
  } catch (error) {
    console.log("expandImage: Error expanding image", error);
    throw error;
  }
}

async function createMask (s3Client, photoshop, originalPresignedGetUrl, baseImageFilename, s3_bucket, s3_key_prefix) {

  try {
    const baseImageExtension = path.extname(baseImageFilename);
    const baseImageNameWithoutExt = path.basename(baseImageFilename, baseImageExtension);
    const maskFilePath = `${s3_key_prefix}/${baseImageNameWithoutExt}_mask_${uuidv4()}${baseImageExtension}`;

    console.log("CREATE MASK: Starting pre-signed URL generation for mask.");
    const maskPresignedPutUrl = await s3Client.getPresignedPutUrl(s3_bucket, maskFilePath, 3600);
    const maskPresignedGetUrl = await s3Client.getPresignedGetUrl(s3_bucket, maskFilePath, 3600);

    const psInput = {
      href: originalPresignedGetUrl,
      storage: StorageType.EXTERNAL
    };

    const psOutput = {
      href: maskPresignedPutUrl,
      storage: StorageType.EXTERNAL
    };

    console.log("CREATE MASK: Starting mask creation in Photoshop.");
    const createMaskResult = await photoshop.createMask({ input: psInput, output: psOutput });
    console.log("CREATE MASK: Mask created. Status:", createMaskResult.result.status);


    console.log("CREATE MASK: Starting mask inversion in Photoshop.");
    const maskInput = [{
      href: maskPresignedGetUrl,
      storage: StorageType.EXTERNAL
    }];

    const invertMaskFilePath = `${s3_key_prefix}/${baseImageNameWithoutExt}_inverted_mask_${uuidv4()}${baseImageExtension}`;

    console.log("CREATE INVERT MASK: Starting pre-signed URL generation for inverting mask.");
    const invertMaskPresignedPutUrl = await s3Client.getPresignedPutUrl(s3_bucket, invertMaskFilePath, 3600);
    const invertMaskPresignedGetUrl = await s3Client.getPresignedGetUrl(s3_bucket, invertMaskFilePath, 3600);

    const maskOutput = [{
      href: invertMaskPresignedPutUrl,
      storage: StorageType.EXTERNAL,
      type: ImageFormatType.IMAGE_PNG
    }];

    const invertFilter = {
      actionJSON: [
        {
          _obj: "invert"
        }
      ]
    };

    const invertMaskResult = await photoshop.playPhotoshopActionsJson({ inputs: maskInput, outputs: maskOutput, options: invertFilter });
    console.log("CREATE MASK: Mask inverted. Status:", invertMaskResult.result.outputs[0].status);

    return invertMaskPresignedGetUrl;

  } catch (error) {
    console.log("CREATE MASK: Error creating mask in Photoshop", error);
    throw error;
  }
}

async function fillImage (firefly, sourcePresignedGetUrl, maskPresignedGetUrl, prompt, numVariations, promptBiasingLocaleCode = "en-US") {
  try {
    console.log(`fillImage: Starting gen fill image with prompt: ${prompt}`);

    const ffInput = {
      image: {
        source: {
          url: sourcePresignedGetUrl
        },
        mask: {
          url: maskPresignedGetUrl
        }
      },
      prompt: prompt,
      numVariations: numVariations,
      promptBiasingLocaleCode: promptBiasingLocaleCode
    };

    const fillImageResults = await firefly.fillImage(ffInput);
    console.log(`fillImage: gen fill image completed`);

    return fillImageResults.result;

  } catch (error) {
    console.log("fillImage: Error filling image", error);
    throw error;
  }
}

// Helper function to get MIME type from file extension
function getMimeType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg'; // Default fallback
  }
}

// Add text overlay using Sharp
async function addTextOverlay(inputPresignedUrl, outputPresignedUrl, textContent, imageFormat, baseImageExtension) {
  try {
    logger.info("addTextOverlay: Starting text overlay with Sharp", {
      textContent,
      inputUrl: inputPresignedUrl.substring(0, 100) + "...",
      outputUrl: outputPresignedUrl.substring(0, 100) + "..."
    });
    
    // Download the input image
    const response = await fetch(inputPresignedUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    
    // Get image dimensions to position text properly
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    
    logger.info("addTextOverlay: Image dimensions", { width, height });
    
    // Calculate text positioning (top left of image)
    const fontSize = Math.floor(width / 20); // Reduced font size (was width/15)
    const textX = Math.floor(width * 0.05); // 5% from left edge
    const textY = Math.floor(height * 0.1); // 10% from top edge
    
    // Create SVG text overlay
    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="black" flood-opacity="0.8"/>
          </filter>
        </defs>
        <text x="${textX}" y="${textY}" 
              font-family="Arial, sans-serif" 
              font-size="${fontSize}" 
              font-weight="normal"
              font-style="italic"
              fill="white" 
              text-anchor="start" 
              filter="url(#shadow)"
              stroke="black" 
              stroke-width="2">
          ${textContent}
        </text>
      </svg>
    `;
    
    logger.info("addTextOverlay: Text styling", { fontSize, position: `(${textX}, ${textY})`, content: textContent });
    
    // Apply text overlay
    const formatWithoutDot = baseImageExtension.replace('.', ''); // Remove dot from extension
    const outputBuffer = await sharp(imageBuffer)
        .composite([{
          input: Buffer.from(svgText),
          top: 0,
          left: 0
        }])
        .toFormat(formatWithoutDot)
        .toBuffer();
    
    logger.info("addTextOverlay: Text overlay applied", { outputSize: `${outputBuffer.length} bytes`, format: formatWithoutDot });
    
    // Upload the result to the output URL
    const uploadResponse = await fetch(outputPresignedUrl, {
      method: 'PUT',
      body: outputBuffer,
      headers: {
        'Content-Type': imageFormat,
        'Content-Length': outputBuffer.length.toString()
      }
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload result: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }
    
    logger.info("addTextOverlay: Successfully uploaded result", { size: `${outputBuffer.length} bytes` });
    
    return {
      status: 'succeeded',
      outputUrl: outputPresignedUrl,
      textContent: textContent,
      fontSize: fontSize,
      dimensions: { width, height }
    };
    
  } catch (error) {
    logger.error("addTextOverlay failed", error);
    throw error;
  }
}

// Generate image using Firefly V3 async API
async function generateImage(firefly, prompt, width, height, numVariations = 1, locale = "en-US") {
  try {
    logger.info("generateImage: Starting image generation", { 
      prompt: prompt.substring(0, 100) + "...", 
      dimensions: `${width}x${height}`,
      numVariations,
      locale
    });

    const generateInput = {
      prompt: prompt,
      numVariations: numVariations,
      size: {
        width: width,
        height: height
      },
      promptBiasingLocaleCode: locale,
      seeds: [Math.floor(Math.random() * 1000000)] // Random seed for variation
    };

    const generateResult = await firefly.generateImages(generateInput);
    logger.info("generateImage: Image generation completed", { 
      status: generateResult.result?.status || 'unknown',
      outputCount: generateResult.result?.outputs?.length || 0
    });

    return generateResult.result;

  } catch (error) {
    logger.error("generateImage: Error generating image", error);
    throw error;
  }
}

export {
  uploadImage,
  expandImage,
  createMask,
  fillImage,
  addTextOverlay,
  getMimeType,
  generateImage
};