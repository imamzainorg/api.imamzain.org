import { docsPage, renderDocsHtml, SCALAR_SRI, SCALAR_URL, SCALAR_VERSION } from "./docs.middleware";

describe("docs page", () => {
  const scriptTag = () => /<script src="([^"]+)"([^>]*)><\/script>/.exec(renderDocsHtml());

  it("pins an exact Scalar version on the 1.x line", () => {
    expect(SCALAR_VERSION).toMatch(/^1\.\d+\.\d+$/);
    expect(SCALAR_URL).toBe(`https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.min.js`);
  });

  it("loads the bundle with a sha384 integrity hash and anonymous CORS", () => {
    const tag = scriptTag();

    expect(SCALAR_SRI).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    expect(tag?.[1]).toBe(SCALAR_URL);
    expect(tag?.[2]).toContain(`integrity="${SCALAR_SRI}"`);
    expect(tag?.[2]).toContain('crossorigin="anonymous"');
  });

  it("never references the unpinned package URL, and keeps the OpenAPI wiring", () => {
    const html = renderDocsHtml();

    expect(html).not.toMatch(/@scalar\/api-reference["'/]/);
    expect(html).toContain('data-url="/openapi.json"');
    expect(html).toContain('id="api-reference"');
  });

  it("serves the page as text/html", () => {
    const res = { setHeader: jest.fn(), send: jest.fn() };

    docsPage({} as never, res as never);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
    expect(res.send).toHaveBeenCalledWith(renderDocsHtml());
  });
});
