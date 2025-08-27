import { S3Client as AWSS3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import https from 'https';
import { Readable } from 'stream';


class S3Client {
    constructor(region, accessKeyId, secretAccessKey) {
        this.s3 = new AWSS3Client({
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
            region,
        });
        this.region = region;
    }

    // Method to get a presigned PUT URL
    async getPresignedPutUrl (bucketName, objectKey, expiration = 3600) {
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
        });
        return await getSignedUrl(this.s3, command, { expiresIn: expiration });
    }

    // Method to get a presigned GET URL
    async getPresignedGetUrl (bucketName, objectKey, expiration = 3600) {
        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
        });
        return await getSignedUrl(this.s3, command, { expiresIn: expiration });
    }

    async streamAssetToS3 (assetUrl, presignedPutUrl, aemToken) {
        try {
            console.log(`Streaming asset from AEM URL: ${assetUrl} to S3`);

            // Fetch the asset binary from AEM
            const assetResponse = await fetch(assetUrl, {
                headers: {
                    Authorization: `Bearer ${aemToken}`,
                },
            });

            if (!assetResponse.ok) {
                throw new Error(`Failed to fetch AEM asset. Status: ${assetResponse.status} - ${assetResponse.statusText}`);
            }

            const contentType = assetResponse.headers.get('content-type') || 'application/octet-stream';
            const contentLength = assetResponse.headers.get('content-length');
            console.log(`Asset Content-Type: ${contentType}`);
            console.log(`Asset Content-Length: ${contentLength}`);

            if (!contentLength) {
                throw new Error('Content-Length header is missing in AEM asset response.');
            }

            // Parse presigned PUT URL components
            const url = new URL(presignedPutUrl);
            const options = {
                method: 'PUT',
                hostname: url.hostname,
                path: url.pathname + url.search,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': contentLength, // Include Content-Length header
                },
            };

            console.log(`S3 PUT Request Options: ${JSON.stringify(options)}`);

            // Make the PUT request to S3
            const putResponse = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    if (res.statusCode === 200) {
                        resolve(res);
                    } else {
                        reject(new Error(`Failed to PUT asset to S3. Status: ${res.statusCode}`));
                    }
                });

                req.on('error', reject); // Handle request errors

                // Pipe the asset stream to the request
                const assetStream = Readable.fromWeb(assetResponse.body);
                assetStream.pipe(req).on('finish', () => req.end());
            });

            console.log(`Successfully streamed asset ${assetUrl} to S3. Response Status: ${putResponse.statusCode}`);
        } catch (error) {
            console.log(`Error streaming asset to S3: ${error.message}`);
            throw error;
        }
    }
}

export default S3Client;