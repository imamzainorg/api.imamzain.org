import { Request, Response } from "express";

// Bump: pick the new version, run `curl -s <SCALAR_URL for it> | openssl dgst -sha384 -binary | openssl base64 -A`
// twice (the two outputs must match), then change SCALAR_VERSION and SCALAR_SRI together. Stay on this major (1.x).
export const SCALAR_VERSION = "1.71.0";
export const SCALAR_SRI = "sha384-UolSRqziag4nQBRl8tUrXaALct9wLj1YAPbC9du4QjJFTYsJNSg+b5l9CGA2up5Y";
export const SCALAR_URL = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.min.js`;

/** The /docs page. The Scalar bundle is pinned and integrity-checked so a compromised CDN copy cannot run in the API's origin. */
export function renderDocsHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <title>imamzain.org API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      data-configuration='{"theme":"purple","layout":"modern","defaultHttpClient":{"targetKey":"javascript","clientKey":"fetch"}}'
    ></script>
    <script src="${SCALAR_URL}" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
  </body>
</html>`;
}

export function docsPage(_req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/html");
  res.send(renderDocsHtml());
}
