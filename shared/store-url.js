export function publicStoreUrl(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) || url.hostname.endsWith('.localhost')) {
    throw Error('Use a public HTTPS product link.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url;
}

export function publicStoreName(url) {
  const host = url.hostname.replace(/^www\./,'');
  return host === 'croma.com' ? 'Croma' : host;
}
