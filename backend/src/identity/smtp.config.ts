export type SmtpConfig = {
  host: string;
  port: 465 | 587;
  user: string;
  password: string;
  from: string;
};

export function parseSmtpEnvironment(
  env: NodeJS.ProcessEnv,
): SmtpConfig | null {
  const enabled = env.AUTH_EMAIL_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false')
    throw new Error('AUTH_EMAIL_ENABLED must be true or false');
  if (enabled === 'false') return null;
  const host = env.SMTP_HOST?.trim() ?? '';
  const port = env.SMTP_PORT ?? '587';
  const user = env.SMTP_USER?.trim() ?? '';
  const password = env.SMTP_PASSWORD ?? '';
  const from = env.SMTP_FROM?.trim() ?? '';
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) ||
    !['465', '587'].includes(port) ||
    !user ||
    user.length > 254 ||
    /[\r\n]/.test(user) ||
    !password ||
    !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(from)
  ) {
    throw new Error(
      'Configure SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASSWORD and SMTP_FROM before enabling email',
    );
  }
  return { host, port: port === '465' ? 465 : 587, user, password, from };
}
