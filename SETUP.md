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
ADOBE_SCOPES=openid,creative_sdk,firefly_api,ff_apis

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
