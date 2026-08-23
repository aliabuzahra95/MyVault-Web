# Google Drive Setup

This is the setup the website needs before the Restore button can ask Google Drive for your MyVault files.

## What The Website Needs

The website needs one Google value:

```text
VITE_GOOGLE_CLIENT_ID
```

This is not a password. It is the public browser app ID that lets Google show the sign-in window for this website.

## What I Checked

The Android project has this Google/Firebase project ID:

```text
myvault-fbfd1
```

But its `google-services.json` file does not contain a Web OAuth client ID that the website can use.

So we need to create a new OAuth client with this type:

```text
Web application
```

## Why This Exists

The Android app already uses Google Drive.

The website is a separate browser app, so Google needs to know that this browser app is allowed to ask you for Drive access.

## Current Scope

The website starts with the same Drive scope the Android app uses:

```text
https://www.googleapis.com/auth/drive.file
```

That scope means the app can work with the specific Drive files used by MyVault, instead of asking for all Drive files.

## Local File

Create this file later, when we are ready to connect for real:

```text
/Users/aliah/Desktop/MyVault-Web/artifacts/myvault-web/.env.local
```

Put this inside it:

```text
VITE_GOOGLE_CLIENT_ID=your-real-client-id-here
```

After that, restart the website server and open:

```text
http://localhost:18899/restore
```

## Google Cloud Steps

Use the Google Cloud project connected to the Android app if possible:

```text
myvault-fbfd1
```

Open:

```text
https://console.developers.google.com/apis/credentials
```

Then:

```text
1. Select the project myvault-fbfd1.
2. Make sure Google Drive API is enabled.
3. Go to OAuth consent / Google Auth Platform branding.
4. Set the app name to MyVault.
5. Set your email as the support email.
6. Add yourself as a test user if Google asks for test users.
7. Go back to Clients / Credentials.
8. Create client.
9. Application type: Web application.
10. Name: MyVault Web Local.
11. Authorized JavaScript origins:
    http://localhost
    http://localhost:18899
12. Do not add a redirect URI for this first local token flow.
13. Copy the Client ID.
```

The client secret is not needed for this website. Do not paste the client secret into the frontend app.

## Why The Website Uses These Values

The website runs locally at:

```text
http://localhost:18899
```

Google requires that exact local website address to be allowed before it will open the sign-in popup.

The first Drive permission scope is:

```text
https://www.googleapis.com/auth/drive.file
```

That matches the Android app and keeps the first restore narrow.

## First Real Restore Step

The first web restore step is read-only.

It will:

```text
Connect to Google Drive
Find MyVault/
Find MyVault/manifests/sync_manifest.json
Show which restore pieces exist
```

It will not:

```text
Edit Google Drive
Delete files
Push website changes back to Drive
```
