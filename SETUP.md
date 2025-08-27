# Creative Automation POC Setup Guide

## Authentication Changes

This project now uses **programmatic access token generation** instead of static tokens. This provides better security and automatic token refresh.

## Required Environment Variables

Create a `.env` file with the following variables:

```env
# Adobe API Configuration (Required)
# Get these from Adobe Developer Console (https://developer.adobe.com/console)
ADOBE_CLIENT_ID=your_adobe_client_id_here
ADOBE_CLIENT_SECRET=your_adobe_client_secret_here
ADOBE_SCOPES=openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis

# AWS S3 Configuration (Required)
# Used for storing generated assets and intermediate files
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
S3_BUCKET_NAME=your_s3_bucket_name
S3_KEY_PREFIX=creative_automation_poc

# Photoshop API URLs (optional - for PSD text processing)
INPUT_PSD_GET_URL=https://your-storage.com/path/to/template.psd
OUTPUT_PSD_PUT_URL=https://your-storage.com/path/to/output.psd
```

## Getting Adobe Credentials

1. Go to [Adobe Developer Console](https://developer.adobe.com/console)
2. Create a new project or select an existing one
3. Add the Firefly API to your project
4. Create credentials (Service Account - OAuth Server-to-Server)
5. Copy the following values to your `.env` file:
   - **Client ID** → `ADOBE_CLIENT_ID`
   - **Client Secret** → `ADOBE_CLIENT_SECRET`

## Getting AWS S3 Credentials

1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Create an IAM user with S3 permissions
3. Generate Access Keys for the user
4. Create an S3 bucket for storing assets
5. Copy the following values to your `.env` file:
   - **Access Key ID** → `AWS_ACCESS_KEY_ID`
   - **Secret Access Key** → `AWS_SECRET_ACCESS_KEY`
   - **Bucket Name** → `S3_BUCKET_NAME`
   - **Region** → `AWS_REGION`

### Required S3 Permissions
The IAM user needs the following permissions on your S3 bucket:
- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`
- `s3:ListBucket`

## What Changed

### Before (Static Token)
- Required manual token generation in Adobe Developer Console
- Tokens expired and needed manual refresh
- Used `FIREFLY_ACCESS_TOKEN` environment variable

### After (Programmatic Token)
- Tokens are generated automatically using OAuth 2.0 Client Credentials flow
- Automatic token refresh with 5-minute buffer before expiry
- Uses `ADOBE_CLIENT_ID` and `ADOBE_CLIENT_SECRET` instead

## Benefits

- ✅ **Automatic token refresh** - No more manual token updates
- ✅ **Better security** - Client credentials instead of long-lived tokens
- ✅ **Error handling** - Graceful handling of authentication failures
- ✅ **Token validation** - Automatic checking of token expiry

## Usage

The authentication is handled automatically when you run the script:

```bash
npm start
```

**Note**: The main script now uses an optimized **hybrid approach**:
- **Parallel processing** for Firefly APIs (fast)
- **Sequential processing** for Photoshop API (avoids rate limits)
- **Best performance** with maximum reliability

The console will show authentication status:
- `✅ Successfully generated Adobe access token`
- `🕒 Token expires at: [timestamp]`
- `🔄 Using existing valid access token` (for subsequent calls)

## Troubleshooting

### "Adobe IMS authentication failed: 400"
- Check that your `ADOBE_CLIENT_ID` and `ADOBE_CLIENT_SECRET` are correct
- Ensure your Adobe Developer Console project has the Firefly API enabled

### "Missing required environment variables"
- Make sure your `.env` file contains all required variables
- Check for typos in variable names

### "No access token received from Adobe IMS"
- Verify your credentials in Adobe Developer Console
- Check that your project has the correct API permissions
