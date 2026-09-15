export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export function parseAuthEnvironment(env: NodeJS.ProcessEnv) {
  const secret = env.BETTER_AUTH_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    /replace|example|change.me/i.test(secret)
  ) {
    throw new Error(
      'BETTER_AUTH_SECRET must be a unique random secret of at least 32 characters',
    );
  }
  let url: URL;
  try {
    url = new URL(env.BETTER_AUTH_URL ?? '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && local && env.NODE_ENV !== 'production'))
    )
      throw new Error();
  } catch {
    throw new Error(
      'BETTER_AUTH_URL must be an HTTPS origin (HTTP loopback allowed outside production)',
    );
  }
  return {
    secret,
    baseURL: url.origin,
    secureCookies: url.protocol === 'https:',
  };
}
export type AuthConfig = ReturnType<typeof parseAuthEnvironment>;
