export function analyticsToken(web, value = '') {
  if (!web) return '';
  const token = value.trim();
  if (token && !/^[a-f0-9]{32}$/i.test(token)) {
    throw new Error('Use the public Cloudflare Web Analytics site token, not an account API key.');
  }
  return token;
}

export function webDocument(html, value = '') {
  const token = analyticsToken(true, value);
  const source = 'https://static.cloudflareinsights.com/beacon.min.js';
  const policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'" + (token ? ' ' + source : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' https: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
  const metadata = '<meta http-equiv="Content-Security-Policy" content="' + policy + '"/><meta name="referrer" content="' + (token ? 'strict-origin' : 'no-referrer') + '"/>';
  // Count page loads without tracking navigation inside the reader.
  const script = token ? '<script type="module" src="' + source + '" data-cf-beacon=\'' + JSON.stringify({token, spa: false}) + '\'></script>' : '';
  return html.replace('<head>', '<head>' + metadata).replace('</body>', script + '</body>');
}
